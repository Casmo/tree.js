import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, type DefinitionPatch } from '../definition';
import { oak } from '../species';
import { loadStyle, STYLE_NAMES } from '../styles/registry';
import { angleBetween, segments, turnAbout, unit, sub } from '../../test/branch-geometry';
import { generateTree, hashTreeData, type SkeletonBranch, type TreeData } from './index';

// Level 1 grows Tip Branches by default, level 2 too; a third level does not.
const base = parseDefinition({ schemaVersion: 3, branches: [{ count: 4 }, { count: 2 }], leaves: { count: 3 } });
const grow = (patch: DefinitionPatch = {}, seed = 5) => generateTree(extendDefinition(base, patch), seed);
const byPath = (data: TreeData) => new Map(data.skeleton.branches.map((b) => [b.path, b]));
const last = (b: SkeletonBranch) => b.points[b.points.length - 1]!;
const levels = (...tipBranches: number[]) => base.branches.map((level, i) => ({ ...level, tipBranches: tipBranches[i] ?? 0 }));

describe('Tip Branches', () => {
  it('grow from the very tip of each parent: first point the parent\'s last point, as thick as the parent\'s tip', () => {
    const branches = byPath(grow());
    // The trunk's Tip Branch comes after its 4 side branches, a level-1 branch's after its 2.
    for (const [parentPath, tipPath] of [['0', '0.4'], ['0.0', '0.0.2'], ['0.4', '0.4.2']] as const) {
      const parent = branches.get(parentPath)!;
      const tip = branches.get(tipPath)!;
      expect(tip.parent).toBe(parentPath);
      expect(tip.attach).toBe(1);
      expect(tip.points[0]!.position).toEqual(last(parent).position);
      expect(tip.points[0]!.radius).toBe(last(parent).radius);
    }
    // Level 2 is the outermost: its branches have no Tip Branch.
    expect(branches.has('0.0.0.0')).toBe(false);
  });

  it("start along the parent's tip tangent, deviating only within the level's angle variation", () => {
    const tipTangent = (b: SkeletonBranch) => segments(b).at(-1)!;
    const tipsOf = (data: TreeData) => data.skeleton.branches.filter((b) => b.tip);
    // Without angle variation: straight on, whatever the level's Angle.
    const straight = grow({ branches: [{ count: 4, angle: 70, angleVariation: 0 }, { count: 2, angle: 50, angleVariation: 0 }] });
    const parents = byPath(straight);
    expect(tipsOf(straight).length).toBe(1 + 5); // the trunk's and each first-level branch's
    for (const tip of tipsOf(straight)) {
      expect(angleBetween(tip.direction, tipTangent(parents.get(tip.parent!)!))).toBeLessThan(1e-3);
      expect(angleBetween(unit(sub(tip.points[1]!.position, tip.points[0]!.position)), tip.direction)).toBeLessThan(20);
    }
    // With it: a small Seed deviation, at most half the Angle times the variation.
    for (const seed of [1, 2, 3, 4]) {
      const data = grow({ branches: [{ count: 4, angle: 60, angleVariation: 0.5 }, { count: 2, angle: 40, angleVariation: 0.5 }] }, seed);
      const all = byPath(data);
      const deviations = tipsOf(data).map((tip) => [tip.level, angleBetween(tip.direction, tipTangent(all.get(tip.parent!)!))] as const);
      for (const [level, deviation] of deviations) expect(deviation).toBeLessThanOrEqual(0.5 * (level === 1 ? 60 : 40) * 0.5 + 1e-6);
      expect(Math.max(...deviations.map(([, d]) => d))).toBeGreaterThan(0.5);
    }
  });

  it('leave every side branch as it is: paths, points and radii identical with Tip Branches 0 to 4', () => {
    for (const seed of [5, 9]) {
      const stumps = grow({ branches: levels(0, 0) }, seed).skeleton.branches;
      for (const tips of [1, 2, 3, 4]) {
        const tipped = grow({ branches: levels(tips, tips) }, seed).skeleton.branches;
        // Every branch of the stump tree is still there, unchanged; the rest are Tip Branches or grow from one.
        const same = byPath({ skeleton: { branches: tipped } } as TreeData);
        for (const b of stumps) expect(same.get(b.path), b.path).toEqual(b);
        const added = tipped.filter((b) => !stumps.some((s) => s.path === b.path));
        for (const b of added) expect(b.path.split('.').some((_, i, parts) => same.get(parts.slice(0, i + 1).join('.'))?.tip), b.path).toBe(true);
        // Each trunk and first-level branch gets exactly that many Tip Branches.
        for (const parent of tipped.filter((b) => b.level < 2)) {
          expect(tipped.filter((b) => b.parent === parent.path && b.tip), parent.path).toHaveLength(tips);
        }
      }
    }
  });

  it('fork a parent with Tip Branches 2 to 4: N branches from its last point, each as thick as its tip', () => {
    for (const n of [2, 3, 4]) {
      const data = grow({ branches: levels(n, n) });
      const all = byPath(data);
      for (const parent of data.skeleton.branches.filter((b) => b.level < 2)) {
        const count = base.branches[parent.level]!.count;
        const tips = data.skeleton.branches.filter((b) => b.parent === parent.path && b.tip);
        expect(tips.map((b) => b.path)).toEqual(Array.from({ length: n }, (_, j) => `${parent.path}.${count + j}`));
        for (const tip of tips) {
          expect(tip.attach).toBe(1);
          expect(tip.points[0]!.position).toEqual(last(all.get(parent.path)!).position);
          expect(tip.points[0]!.radius).toBe(last(all.get(parent.path)!).radius);
        }
      }
    }
  });

  it("splay a fork by half the Angle times the angle curve at the tip, its N branches 360°/N apart", () => {
    const forksOf = (data: TreeData) =>
      data.skeleton.branches
        .filter((b) => b.level < 2)
        .map((parent) => ({ tangent: segments(parent).at(-1)!, tips: data.skeleton.branches.filter((b) => b.parent === parent.path && b.tip) }));
    for (const n of [2, 3, 4]) {
      // Without angle variation: exactly half the Angle, times the angle curve at 1 (0.5 here) on level 2.
      const exact = grow({
        branches: [
          { count: 4, angle: 60, angleVariation: 0, tipBranches: n },
          { count: 2, angle: 40, angleVariation: 0, angleProfile: [{ t: 0, value: 2 }, { t: 1, value: 0.5 }], tipBranches: n },
        ],
      });
      const forks = forksOf(exact);
      expect(forks.length).toBeGreaterThan(1);
      for (const { tangent, tips } of forks) {
        const lean = tips[0]!.level === 1 ? 0.5 * 60 : 0.5 * 40 * 0.5;
        for (const tip of tips) expect(angleBetween(tip.direction, tangent)).toBeCloseTo(lean, 6);
        // Evenly around the parent's tip tangent, in path order.
        tips.forEach((tip, j) => {
          const turn = (turnAbout(tips[0]!.direction, tip.direction, tangent) + 1) % 1;
          expect(Math.min(Math.abs(turn - j / n), 1 - Math.abs(turn - j / n))).toBeLessThan(1e-6);
        });
      }
      // With angle variation: within it, around the same half Angle.
      for (const seed of [1, 2, 3]) {
        const varied = grow({ branches: [{ count: 4, angle: 60, angleVariation: 0.4, tipBranches: n }, { count: 2, angle: 60, angleVariation: 0.4, tipBranches: n }] }, seed);
        const leans = forksOf(varied).flatMap(({ tangent, tips }) => tips.map((tip) => angleBetween(tip.direction, tangent)));
        for (const lean of leans) {
          expect(lean).toBeGreaterThanOrEqual(30 * 0.6 - 1e-6);
          expect(lean).toBeLessThanOrEqual(30 * 1.4 + 1e-6);
        }
        expect(Math.max(...leans) - Math.min(...leans)).toBeGreaterThan(1);
      }
    }
  });

  it('take the paths after the side branches, which Sculpts keep addressing; a Tip Branch can be Sculpted too', () => {
    const data = grow({}, 5);
    const children = (path: string) => data.skeleton.branches.filter((b) => b.parent === path);
    expect(children('0').map((b) => [b.path, !!b.tip])).toEqual([['0.0', false], ['0.1', false], ['0.2', false], ['0.3', false], ['0.4', true]]);
    expect(children('0.2').map((b) => [b.path, !!b.tip])).toEqual([['0.2.0', false], ['0.2.1', false], ['0.2.2', true]]);

    // A Sculpt made on a side branch before Tip Branches lands on the same branch with them.
    const move = { seed: 5, path: '0.2', action: 'move' as const, rotation: [0, 0, 0.5] as [number, number, number], scale: 0.8 };
    const before = grow({ branches: levels(0, 0), sculpts: [move] }).skeleton.branches.find((b) => b.path === '0.2');
    const after = grow({ sculpts: [move] }).skeleton.branches.find((b) => b.path === '0.2');
    expect(after).toEqual(before);

    // Deleting the trunk's Tip Branch takes it and its twigs away, and nothing else.
    const pruned = grow({ sculpts: [{ seed: 5, path: '0.4', action: 'delete' }] }).skeleton.branches;
    expect(pruned).toEqual(data.skeleton.branches.filter((b) => b.path !== '0.4' && !b.path.startsWith('0.4.')));
  });

  it("start growing when their parent is fully grown, as a side branch at its base would", () => {
    // Without Seed timing variation, a window starts exactly where the (warp-free) timeline puts it.
    const data = grow({ variation: { growth: 0 } });
    const windows = new Map(data.skeleton.branches.map((b, i) => [b.path, { ...b, growth: data.growth.branches[i]! }]));
    const tips = [...windows.values()].filter((b) => b.tip);
    expect(tips.length).toBeGreaterThan(0);
    for (const tip of tips) {
      const parent = windows.get(tip.parent!)!;
      expect(tip.growth.start).toBeCloseTo(parent.growth.end, 9);
      // Its side siblings all start later, from their place along the parent.
      for (const side of [...windows.values()].filter((b) => b.parent === tip.parent && !b.tip)) {
        expect(side.growth.start).toBeGreaterThan(tip.growth.start);
      }
    }
  });

  it('grow next-level branches of their own, and leaves and Fruit when they are outermost', () => {
    const data = grow({ fruit: { type: 'round', count: 1 } });
    const { branches, leaves, fruit } = data.skeleton;
    // The trunk's Tip Branch (level 1) has the level-2 side branches and its own Tip Branch.
    expect(branches.filter((b) => b.parent === '0.4').map((b) => b.path)).toEqual(['0.4.0', '0.4.1', '0.4.2']);
    // Level-2 Tip Branches are outermost: leaves and Fruit like their side siblings.
    for (const twig of branches.filter((b) => b.level === 2)) {
      expect(leaves.filter((l) => l.branch === twig.path)).toHaveLength(3);
      expect(fruit.filter((f) => f.branch === twig.path)).toHaveLength(1);
    }
    expect(branches.filter((b) => b.level === 2 && b.tip).length).toBe(4 + 1); // one on each first-level branch

    // A tree with only one level: the trunk's Tip Branch is outermost and bears leaves.
    const single = generateTree(parseDefinition({ schemaVersion: 3, branches: [{ count: 3 }], leaves: { count: 4 }, fruit: { type: 'round', count: 2 } }), 5);
    expect(single.skeleton.branches.map((b) => [b.path, !!b.tip])).toEqual([['0', false], ['0.0', false], ['0.1', false], ['0.2', false], ['0.3', true]]);
    expect(single.skeleton.leaves.filter((l) => l.branch === '0.3')).toHaveLength(4);
    expect(single.skeleton.fruit.filter((f) => f.branch === '0.3')).toHaveLength(2);
  });

  it('carry every Stem of a multi-Stem tree on, also a Stem nodding over under Trunk gravity', () => {
    const data = grow({ trunk: { stems: 3, spread: 20, gravity: -0.8 } });
    const all = byPath(data);
    for (const stem of ['0', '1', '2']) {
      const tip = all.get(`${stem}.4`)!;
      expect(tip.tip).toBe(true);
      expect(tip.points[0]!.position).toEqual(last(all.get(stem)!).position);
      // It carries on the nodding direction (within the level's angle variation), not straight up.
      expect(angleBetween(tip.direction, segments(all.get(stem)!).at(-1)!)).toBeLessThanOrEqual(0.5 * 45 * 0.2 + 1e-6);
    }
  });

  it('give the same tree for the same Definition and Seed, and Tip Branches 0 on every level gives the tree from before them', () => {
    expect(hashTreeData(grow({}, 11))).toBe(hashTreeData(grow({}, 11)));
    expect(grow({}, 11).skeleton).toEqual(grow({}, 11).skeleton);
    expect(hashTreeData(grow({}, 11))).not.toBe(hashTreeData(grow({}, 12)));
    // Hashes of this Definition generated before Tip Branches existed.
    expect([5, 11].map((seed) => hashTreeData(grow({ branches: levels(0, 0) }, seed)))).toEqual(BEFORE_TIP_BRANCHES);
  });
});

describe('Tip Branches in every Style', () => {
  it.each(STYLE_NAMES)('%s passes a level\'s Tip Branches through like its count and draws them', async (name) => {
    const style = await loadStyle(name);
    // Absent on the Species: the default, Tip Branches on the first two levels.
    const drawn = style.apply(oak);
    expect(drawn.branches.map((level) => level.tipBranches)).toEqual(oak.branches.map(() => undefined));
    const tips = generateTree(drawn, 1).skeleton.branches.filter((b) => b.tip);
    expect(new Set(tips.map((b) => b.level))).toEqual(new Set([1, 2].filter((level) => level <= drawn.branches.length)));
    // Set on the Species: kept, and 0 everywhere draws no Tip Branch.
    const set = style.apply({ ...oak, branches: oak.branches.map((level, i) => ({ ...level, tipBranches: i === 0 ? 3 : 0 })) });
    expect(set.branches.map((level) => level.tipBranches)).toEqual(oak.branches.map((_, i) => (i === 0 ? 3 : 0)));
    const none = style.apply({ ...oak, branches: oak.branches.map((level) => ({ ...level, tipBranches: 0 })) });
    expect(generateTree(none, 1).skeleton.branches.some((b) => b.tip)).toBe(false);
    // Re-applying a Style to a drawn Definition keeps them too.
    expect(style.apply(set).branches.map((level) => level.tipBranches)).toEqual(set.branches.map((level) => level.tipBranches));
  });
});

/** Seeds 5 and 11, recorded with the generator from before Tip Branches (commit abc43a8). */
const BEFORE_TIP_BRANCHES = ['6996ecf8', 'b4eb192d'];
