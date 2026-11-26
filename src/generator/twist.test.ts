import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, type BranchLevelDefinition, type TreeDefinitionInput } from '../definition';
import { angleBetween, apart, carried, cross, DEG, dot, expectNoKinks, mean, scale, segments, sideAt, sub, turnAbout, turned, turnsAround, unit } from '../../test/branch-geometry';
import { generateTree, hashTreeData, type SkeletonBranch, type Vec3 } from './index';

/** Turns of a branch: the local peaks of how far its segments swing away from its start direction. */
const turnsOf = (b: SkeletonBranch) => {
  const away = segments(b).map((d) => angleBetween(d, b.direction));
  return away.filter((a, i) => a > (away[i - 1] ?? -1) && a > (away[i + 1] ?? -1)).length;
};

/** Two branch levels: a low-poly-like first level (2 Sections) and a finer second level (7 Sections). */
const levels = [
  { count: 4, sections: 2, bend: 0.1, gravity: 0.1 },
  { count: 3, sections: 7, bend: 0.1, gravity: 0 },
];
const define = (twists: Partial<BranchLevelDefinition>[] = [], extra: TreeDefinitionInput = { schemaVersion: 3 }) =>
  parseDefinition({ ...extra, schemaVersion: 3, branches: levels.map((level, i) => ({ ...level, ...twists[i] })), leaves: { count: 4 } });
const grow = (twists: Partial<BranchLevelDefinition>[] = [], seed = 5) => generateTree(define(twists), seed);
/** The side branches on `level` (a Tip Branch leaves its parent straight on, see tip-branches.test.ts). */
const onLevel = (data: ReturnType<typeof generateTree>, level: number) => data.skeleton.branches.filter((b) => b.level === level && !b.tip);
const sectionsOf = (b: SkeletonBranch) => b.points.length - 1;
const lengthOf = (b: SkeletonBranch) => segmentLengths(b).reduce((a, l) => a + l, 0);
const segmentLengths = (b: SkeletonBranch) => b.points.slice(1).map((p, i) => Math.hypot(...sub(p.position, b.points[i]!.position)));
/** The point at fraction `t` of a branch's length. */
function pointAt(b: SkeletonBranch, t: number): Vec3 {
  const lengths = segmentLengths(b);
  let left = t * lengthOf(b);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]! || i === lengths.length - 1) {
      const f = left / lengths[i]!;
      const [a, c] = [b.points[i]!.position, b.points[i + 1]!.position];
      return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    }
    left -= lengths[i]!;
  }
  return b.points.at(-1)!.position;
}
/** The direction of the centre-line segment at fraction `t` of a branch's length. */
function tangentAt(b: SkeletonBranch, t: number): Vec3 {
  const lengths = segmentLengths(b);
  let left = t * lengthOf(b);
  let i = 0;
  while (i < lengths.length - 1 && left > lengths[i]!) left -= lengths[i++]!;
  return segments(b)[i]!;
}
const expectNear = (a: Vec3, b: Vec3, tolerance: number) => expect(Math.hypot(...sub(a, b))).toBeLessThan(tolerance);
const tipOf = (b: SkeletonBranch) => b.points.at(-1)!.position;

describe('Twist on branch levels', () => {
  it('Twist 0 or absent gives exactly today\'s tree (paths, skeleton, geometry hash)', () => {
    const plain = grow();
    for (const twist of [{ twist: 0 }, { twist: 0, twists: 7 }]) {
      const data = grow([twist, twist]);
      expect(data.skeleton).toEqual(plain.skeleton);
      expect(hashTreeData(data)).toBe(hashTreeData(plain));
    }
  });

  it('builds a twisted branch with max(Sections, 3 × Twists) Sections; Twists is 2 while absent', () => {
    const data = grow([{ twist: 0.5 }, { twist: 0.5, twists: 2 }]);
    for (const b of onLevel(data, 1)) expect(sectionsOf(b)).toBe(6); // max(2, 3 × 2)
    for (const b of onLevel(data, 2)) expect(sectionsOf(b)).toBe(7); // max(7, 3 × 2)
    const snaking = grow([{ twist: 0.5, twists: 4 }, { twist: 0.5, twists: 3 }]);
    for (const b of onLevel(snaking, 1)) expect(sectionsOf(b)).toBe(12);
    for (const b of onLevel(snaking, 2)) expect(sectionsOf(b)).toBe(9);
  });

  it('leaves the straight course smoothly (no kinks), swinging about Twist × 45° at every turn', () => {
    const straight = [{ bend: 0, gravity: 0, sections: 2 }, { bend: 0, gravity: 0 }];
    const data = generateTree(define([{ ...straight[0], twist: 1, twists: 2 }, { ...straight[1], twist: 0.5, twists: 3 }]), 5);
    for (const [level, swing] of [[1, 45], [2, 22.5]] as const) {
      for (const b of onLevel(data, level)) {
        const dirs = segments(b);
        const away = Math.max(...dirs.map((d) => angleBetween(d, b.direction)));
        expect(away).toBeGreaterThan(swing * 0.9);
        expect(away).toBeLessThan(swing * 1.1);
        // Between neighbouring segments the direction changes by at most about half a swing.
        for (let i = 1; i < dirs.length; i++) expect(angleBetween(dirs[i - 1]!, dirs[i]!)).toBeLessThan(swing * 0.75);
      }
    }
    // Untwisted, the same branches are straight.
    for (const b of onLevel(generateTree(define(straight), 5), 1)) expect(segments(b).every((d) => angleBetween(d, b.direction) < 1e-6)).toBe(true);
  });

  it('changes direction Twists times over the branch, whatever its length: more Twists, more direction changes', () => {
    const flat = { bend: 0, gravity: 0 };
    for (const twists of [1, 2, 4, 8]) {
      const data = generateTree(define([{ ...flat, twist: 0.6, twists }, { ...flat, twist: 0.6, twists }]), 9);
      for (const b of data.skeleton.branches.filter((b) => b.level > 0)) expect(turnsOf(b), `${b.path}, twists ${twists}`).toBe(twists);
    }
  });

  it('is Seed-bound: the same Seed gives the same tree, another Seed other twists, and siblings twist differently', () => {
    const twist = [{ twist: 0.7, twists: 3 }, { twist: 0.7, twists: 3 }];
    const data = grow(twist, 5);
    expect(grow(twist, 5).skeleton).toEqual(data.skeleton);
    expect(hashTreeData(grow(twist, 5))).toBe(hashTreeData(data));
    // The Twist only: compare against the untwisted tree of each Seed.
    const bends = (seed: number) => {
      const plain = new Map(grow([], seed).skeleton.branches.map((b) => [b.path, b]));
      return onLevel(grow(twist, seed), 1).map((b) => segments(b).map((d) => angleBetween(d, plain.get(b.path)!.direction)));
    };
    expect(bends(6)).not.toEqual(bends(5));
    // Siblings: the side each first turn swings to, around the branch, differs.
    const firstTurn = onLevel(data, 1).map((b) => unit(sub(b.points[2]!.position, b.points[0]!.position)));
    for (let i = 1; i < firstTurn.length; i++) expect(angleBetween(firstTurn[i]!, firstTurn[0]!)).toBeGreaterThan(1);
    const sides = onLevel(generateTree(define(twist.map((t) => ({ ...t, bend: 0, gravity: 0 }))), 5), 1).map((b) => {
      const side = sub(segments(b)[1]!, b.direction);
      return unit(sub(side, scale(b.direction, side[0] * b.direction[0] + side[1] * b.direction[1] + side[2] * b.direction[2])));
    });
    expect(new Set(sides.map((s) => s.map((v) => v.toFixed(3)).join())).size).toBe(sides.length);
  });

  it('only reshapes the curves: branch paths, counts, lengths, start angles and attach fractions stay', () => {
    const plain = grow();
    for (const twist of [{ twist: 0.3, twists: 1 }, { twist: 1, twists: 8 }]) {
      const data = grow([twist, twist]);
      expect(data.skeleton.branches.map((b) => b.path)).toEqual(plain.skeleton.branches.map((b) => b.path));
      expect(data.skeleton.leaves.map((l) => [l.id, l.attach])).toEqual(plain.skeleton.leaves.map((l) => [l.id, l.attach]));
      data.skeleton.branches.forEach((b, i) => {
        const before = plain.skeleton.branches[i]!;
        if (b.level === 0) return;
        expect([b.attach, b.level, b.parent]).toEqual([before.attach, before.level, before.parent]);
        // The same angle to the parent where it attaches (on the trunk, which has no Twist, the same direction).
        if (b.level === 1) expect(b.direction).toEqual(before.direction);
        const parentAt = (data: ReturnType<typeof generateTree>, branch: SkeletonBranch) =>
          tangentAt(data.skeleton.branches.find((p) => p.path === branch.parent)!, branch.attach);
        expect(angleBetween(b.direction, parentAt(data, b))).toBeCloseTo(angleBetween(before.direction, parentAt(plain, before)), 6);
        expect(lengthOf(b)).toBeCloseTo(lengthOf(before), 9);
        expect(b.points[0]!.radius).toBeCloseTo(before.points[0]!.radius, 12);
        expect(b.points.at(-1)!.radius).toBeCloseTo(before.points.at(-1)!.radius, 12);
      });
    }
  });

  it('attaches children, leaves and Fruit at the same fraction along a twisted branch', () => {
    const def = define([{ twist: 0.8, twists: 3 }, { twist: 0.8, twists: 2 }], { schemaVersion: 3, fruit: { count: 2 } });
    const data = generateTree(def, 5);
    const byPath = new Map(data.skeleton.branches.map((b) => [b.path, b]));
    for (const child of data.skeleton.branches.filter((b) => b.parent)) {
      expectNear(child.points[0]!.position, pointAt(byPath.get(child.parent!)!, child.attach), 1e-9);
    }
    expect(data.skeleton.leaves.length).toBeGreaterThan(0);
    for (const leaf of data.skeleton.leaves) expectNear(leaf.position, pointAt(byPath.get(leaf.branch)!, leaf.attach), 1e-9);
    expect(data.skeleton.fruit.length).toBeGreaterThan(0);
    for (const fruit of data.skeleton.fruit) expectNear(fruit.position, pointAt(byPath.get(fruit.branch)!, fruit.attach), 1e-9);
  });

  it('keeps Bend\'s jitter on the original Sections: the extra Sections add no kinks', () => {
    // 2 and 3 Sections built as 12; barely twisted, so only Bend turns the branch.
    const rough = [{ sections: 2, bend: 0.4, gravity: 0 }, { sections: 3, bend: 0.4, gravity: 0 }];
    const plain = generateTree(define(rough), 5);
    const barely = generateTree(define(rough.map((p) => ({ ...p, twist: 1e-9, twists: 4 }))), 5);
    const byPath = new Map(barely.skeleton.branches.map((b) => [b.path, b]));
    for (const before of plain.skeleton.branches.filter((b) => b.level > 0)) {
      const after = byPath.get(before.path)!;
      expect(sectionsOf(after)).toBe(12);
      const every = 12 / sectionsOf(before);
      // Straight within each original Section, turning only where today's branch turns, and through today's points.
      const dirs = segments(after);
      dirs.forEach((d, i) => expect(angleBetween(d, segments(before)[Math.floor(i / every)]!)).toBeLessThan(1e-4));
      before.points.forEach((p, i) => expectNear(after.points[i * every]!.position, p.position, 1e-6));
    }
  });

  it('spreads Gravity\'s pull over the extra Sections: its total effect stays the same', () => {
    const level = { sections: 2, bend: 0 };
    const drops = (twist: Partial<BranchLevelDefinition>) => {
      const tips = (gravity: number) => onLevel(generateTree(define([{ ...level, ...twist, gravity }]), 5), 1).map((b) => tipOf(b)[1]);
      const flat = tips(0);
      return tips(-0.4).map((y, i) => flat[i]! - y);
    };
    const today = drops({});
    const twisted = drops({ twist: 1e-9, twists: 4 }); // 12 Sections instead of 2
    today.forEach((drop, i) => {
      expect(drop).toBeGreaterThan(0);
      expect(twisted[i]! / drop).toBeGreaterThan(0.6);
      expect(twisted[i]! / drop).toBeLessThan(1.2);
    });
  });

  it('lets Gravity still pull a twisted branch down or up overall', () => {
    const twist = { twist: 0.6, twists: 3, bend: 0 };
    const heights = (gravity: number) => onLevel(grow([{ ...twist, gravity }, { ...twist, gravity }]), 2).map((b) => tipOf(b)[1] - b.points[0]!.position[1]);
    const flat = mean(heights(0));
    expect(mean(heights(-1))).toBeLessThan(flat - 0.1);
    expect(mean(heights(1))).toBeGreaterThan(flat + 0.1);
  });

  it('keeps Sculpts working: they address the same paths and still apply', () => {
    const twisted = define([{ twist: 0.8, twists: 3 }, { twist: 0.8 }]);
    const sculpted = extendDefinition(twisted, { sculpts: [{ seed: 5, path: '0.1', action: 'delete' }] });
    const data = generateTree(sculpted, 5);
    const gone = (path: string) => path === '0.1' || path.startsWith('0.1.');
    expect(data.skeleton.branches.map((b) => b.path)).toEqual(generateTree(twisted, 5).skeleton.branches.map((b) => b.path).filter((p) => !gone(p)));
    expect(data.skeleton.leaves.some((l) => gone(l.branch))).toBe(false);
  });
});

describe('Corkscrew Twist on branch levels', () => {
  const corkscrew = (twist: number, twists?: number, more: Partial<BranchLevelDefinition> = {}): Partial<BranchLevelDefinition> => ({
    twistStyle: 'corkscrew',
    twist,
    ...(twists === undefined ? {} : { twists }),
    ...more,
  });

  it('builds a Corkscrew branch with max(Sections, 6 × Twists) Sections; Twist 0 changes nothing', () => {
    const data = grow([corkscrew(0.5), corkscrew(0.5, 1)]);
    for (const b of onLevel(data, 1)) expect(sectionsOf(b)).toBe(12); // max(2, 6 × 2)
    for (const b of onLevel(data, 2)) expect(sectionsOf(b)).toBe(7); // max(7, 6 × 1)
    const tight = grow([corkscrew(0.5, 4), corkscrew(0.5, 3)]);
    for (const b of onLevel(tight, 1)) expect(sectionsOf(b)).toBe(24);
    for (const b of onLevel(tight, 2)) expect(sectionsOf(b)).toBe(18);
    const plain = grow();
    const untwisted = grow([corkscrew(0, 4, { spin: 'clockwise' }), corkscrew(0)]);
    expect(untwisted.skeleton).toEqual(plain.skeleton);
    expect(hashTreeData(untwisted)).toBe(hashTreeData(plain));
  });

  /** Straight courses (no Bend, no Gravity), so the course is each branch's start direction. */
  const straight = (more: Partial<BranchLevelDefinition>[]) =>
    generateTree(define(more.map((m, i) => ({ sections: i === 0 ? 2 : 7, bend: 0, gravity: 0, ...m }))), 5);

  it('spirals around its course: leaning about Twist × 45° off it while its side makes Twists full turns', () => {
    for (const [twist, twists] of [[1, 2], [0.5, 3], [0.8, 1]] as const) {
      const data = straight([corkscrew(twist, twists), corkscrew(twist, twists)]);
      for (const b of data.skeleton.branches.filter((b) => b.level > 0)) {
        const lean = segments(b).map((d) => angleBetween(d, b.direction));
        // Past the ease-in (the first half turn) it leans steadily by Twist × 45°.
        const steady = lean.slice(Math.ceil(sectionsOf(b) / twists / 2));
        for (const a of steady) expect(a, `${b.path} twist ${twist}`).toBeCloseTo(twist * 45, 0);
        expect(Math.abs(turnsAround(b)), `${b.path} twists ${twists}`).toBeGreaterThan(twists - 0.25);
        expect(Math.abs(turnsAround(b))).toBeLessThan(twists + 0.05);
      }
    }
  });

  it('leaves its start direction smoothly and has no kinks anywhere', () => {
    const data = straight([corkscrew(1, 2), corkscrew(1, 3)]);
    for (const b of data.skeleton.branches.filter((b) => b.level > 0)) {
      const dirs = segments(b);
      expect(angleBetween(dirs[0]!, b.direction)).toBeLessThan(10);
      // Never more than the steady step of a 45° lean on 6 Sections per turn (≈ 41°).
      expectNoKinks(dirs, 42, 25);
    }
  });

  it('turns clockwise or counter-clockwise (seen from its base) as its Spin says', () => {
    for (const [spin, sign] of [['clockwise', 1], ['counterclockwise', -1]] as const) {
      const data = straight([corkscrew(0.6, 2, { spin }), corkscrew(0.6, 3, { spin })]);
      for (const b of data.skeleton.branches.filter((b) => b.level > 0)) expect(Math.sign(turnsAround(b)), `${spin} ${b.path}`).toBe(sign);
    }
  });

  it('picks a Random Spin per branch from the Seed: the same Seed gives the same tree, siblings may turn either way', () => {
    const random = [corkscrew(0.6, 2), corkscrew(0.6, 2, { spin: 'random' })];
    const data = straight(random);
    expect(straight(random).skeleton).toEqual(data.skeleton);
    expect(hashTreeData(straight(random))).toBe(hashTreeData(data));
    const spins = data.skeleton.branches.filter((b) => b.level > 0).map((b) => Math.sign(turnsAround(b)));
    expect(spins).toContain(1);
    expect(spins).toContain(-1);
  });

  it('only reshapes the curves: paths, lengths, start directions and attach fractions stay; Snake trees stay as they were', () => {
    const plain = grow();
    const data = grow([corkscrew(0.9, 3), corkscrew(0.9, 2)]);
    expect(data.skeleton.branches.map((b) => [b.path, b.attach])).toEqual(plain.skeleton.branches.map((b) => [b.path, b.attach]));
    expect(data.skeleton.leaves.map((l) => [l.id, l.attach])).toEqual(plain.skeleton.leaves.map((l) => [l.id, l.attach]));
    data.skeleton.branches.forEach((b, i) => {
      if (b.level === 1) expect(b.direction).toEqual(plain.skeleton.branches[i]!.direction);
      expect(lengthOf(b)).toBeCloseTo(lengthOf(plain.skeleton.branches[i]!), 9);
    });
    // A Snake written out is the Snake of today.
    const snake = [{ twist: 0.7, twists: 3 }, { twist: 0.5 }];
    const written = grow(snake.map((t) => ({ ...t, twistStyle: 'snake' as const, spin: 'clockwise' as const })));
    expect(written.skeleton).toEqual(grow(snake).skeleton);
    expect(hashTreeData(written)).toBe(hashTreeData(grow(snake)));
  });

  it('lets Gravity and Bend still apply on top of a Corkscrew', () => {
    const twist = corkscrew(0.6, 3, { bend: 0 });
    const heights = (gravity: number) => onLevel(grow([{ ...twist, gravity }, { ...twist, gravity }]), 2).map((b) => tipOf(b)[1] - b.points[0]!.position[1]);
    const flat = mean(heights(0));
    expect(mean(heights(-1))).toBeLessThan(flat - 0.1);
    expect(mean(heights(1))).toBeGreaterThan(flat + 0.1);
    const tips = (bend: number) => onLevel(grow([corkscrew(0.6, 3, { bend, gravity: 0 })]), 1).map(tipOf);
    const bent = tips(0.4);
    tips(0).forEach((tip, i) => expect(Math.hypot(...sub(tip, bent[i]!))).toBeGreaterThan(0.01));
  });
});

describe('Twist Curve on Corkscrew branch levels', () => {
  const curved = (twistCurve: number | undefined, more: Partial<BranchLevelDefinition> = {}): Partial<BranchLevelDefinition> => ({
    twistStyle: 'corkscrew',
    twist: 0.2,
    twists: 2,
    ...(twistCurve === undefined ? {} : { twistCurve }),
    ...more,
  });
  /** Straight courses (no Bend, no Gravity), so without a Twist Curve the course is each branch's start direction. */
  const straight = (more: Partial<BranchLevelDefinition>[], seed = 5) =>
    generateTree(define(more.map((m, i) => ({ sections: i === 0 ? 2 : 7, bend: 0, gravity: 0, ...m }))), seed);
  const twigs = (data: ReturnType<typeof generateTree>) => data.skeleton.branches.filter((b) => b.level > 0);
  const endHeading = (b: SkeletonBranch) => angleBetween(segments(b).at(-1)!, b.direction);

  it('Twist Curve 0 ends heading along the course (a plain corkscrew, as without it); 1 ends about 180° from the start heading', () => {
    const plain = straight([curved(undefined), curved(undefined)]);
    expect(straight([curved(0), curved(0)]).skeleton).toEqual(plain.skeleton);
    // The lean of Twist 0.2 is 9° off the course.
    for (const b of twigs(plain)) expect(endHeading(b), b.path).toBeLessThan(10);
    for (const b of twigs(straight([curved(1), curved(1)]))) expect(endHeading(b), b.path).toBeGreaterThan(165);
    for (const b of twigs(straight([curved(0.5), curved(0.5)]))) {
      expect(endHeading(b), b.path).toBeGreaterThan(75);
      expect(endHeading(b), b.path).toBeLessThan(105);
    }
  });

  it('stays smooth with no kinks, also curling back on Twist Curve 1 with a wide spiral', () => {
    for (const twist of [0.2, 1]) {
      const data = straight([curved(1, { twist }), curved(1, { twist, twists: 3 })]);
      for (const b of twigs(data)) {
        const dirs = segments(b);
        // The turn between Sections changes gradually: no Section turns much more than the one before it.
        expectNoKinks(dirs, 60, 30, `${b.path} twist ${twist}`);
        for (const d of dirs) for (const v of d) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('adds no Sections, and changes nothing on a Snake or without Twist', () => {
    const plain = grow([curved(undefined), curved(undefined, { twists: 3 })]);
    const data = grow([curved(1), curved(0.4, { twists: 3 })]);
    data.skeleton.branches.forEach((b, i) => expect(sectionsOf(b)).toBe(sectionsOf(plain.skeleton.branches[i]!)));
    const snake = [{ twist: 0.7, twists: 3 }, { twist: 0.5 }];
    const curvedSnake = grow(snake.map((t) => ({ ...t, twistCurve: 1 })));
    expect(curvedSnake.skeleton).toEqual(grow(snake).skeleton);
    expect(hashTreeData(curvedSnake)).toBe(hashTreeData(grow(snake)));
    const untwisted = grow([{ twistStyle: 'corkscrew', twistCurve: 1 }, { twistStyle: 'corkscrew', twist: 0, twistCurve: 0.5 }]);
    expect(untwisted.skeleton).toEqual(grow().skeleton);
    expect(hashTreeData(untwisted)).toBe(hashTreeData(grow()));
  });

  it('bends to a side the Seed picks: the same Seed gives the same tree, siblings bend different ways', () => {
    const levels = [curved(0.8), curved(0.8)];
    const data = straight(levels);
    expect(straight(levels).skeleton).toEqual(data.skeleton);
    expect(hashTreeData(straight(levels))).toBe(hashTreeData(data));
    expect(straight(levels, 6).skeleton).not.toEqual(data.skeleton);
    // Each first-level branch's bend side around its start direction, measured from straight up (degrees).
    const sides = onLevel(data, 1).map((b) => {
      const mean = segments(b).reduce((a, d) => [a[0] + d[0], a[1] + d[1], a[2] + d[2]] as Vec3, [0, 0, 0] as Vec3);
      const side = sub(mean, scale(b.direction, dot(mean, b.direction)));
      const up = unit(sub([0, 1, 0], scale(b.direction, b.direction[1])));
      return Math.atan2(dot(cross(up, side), b.direction), dot(up, side)) * DEG;
    });
    expect(Math.max(...sides.flatMap((a) => sides.map((b) => apart(a, b))))).toBeGreaterThan(90);
  });

  it('lets Gravity and Bend still apply on top of a curved Corkscrew', () => {
    const heights = (gravity: number) => onLevel(grow([curved(0.6, { gravity, bend: 0 }), curved(0.6, { gravity, bend: 0 })]), 2).map((b) => tipOf(b)[1] - b.points[0]!.position[1]);
    const flat = mean(heights(0));
    expect(mean(heights(-1))).toBeLessThan(flat - 0.1);
    expect(mean(heights(1))).toBeGreaterThan(flat + 0.1);
  });
});

describe('Corkscrew rolls its bark and what grows on it (ADR 0016)', () => {
  /** `x` (turns) wrapped into -0.5 .. 0.5. */
  const wrapped = (x: number) => x - Math.round(x);
  /**
   * Barely-twisted courses (straight, Twist 0.02 so the lean is under 1°), so what is measured is
   * the roll of the frames, not the path. Level 1 holds side branches, level 2 leaves and Fruit.
   */
  const tree = (more: Partial<BranchLevelDefinition>[]) =>
    generateTree(
      parseDefinition({
        schemaVersion: 3,
        branches: more.map((m, i) => ({ count: i === 0 ? 3 : 6, sections: i === 0 ? 2 : 7, bend: 0, gravity: 0, spiral: 0, ...m })),
        leaves: { count: 8 },
        fruit: { count: 3, hang: 0 },
      }),
      5,
    );
  const barely = (more: Partial<BranchLevelDefinition> = {}): Partial<BranchLevelDefinition> => ({ twistStyle: 'corkscrew', twist: 0.02, ...more });

  /** The u = 0 bark seam of a branch: per ring, its seam vertex's way out from the ring's centre. */
  function seam(data: ReturnType<typeof generateTree>, b: SkeletonBranch): Vec3[] {
    const { positions } = data.wood;
    const { aOrigin } = data.wood.attributes;
    const base = b.points[0]!.position.map((x) => Math.fround(x));
    const mine: number[] = [];
    for (let v = 0; v < aOrigin.array.length / 3; v++) if ([0, 1, 2].every((k) => aOrigin.array[v * 3 + k] === base[k])) mine.push(v);
    const rings = b.points.length;
    const ringSize = (mine.length - 1) / rings;
    expect(Number.isInteger(ringSize)).toBe(true);
    return b.points.map((p, r) => {
      const v = mine[0]! + r * ringSize;
      return sub([positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!], p.position);
    });
  }
  /** Turns the bark seam makes around a branch from base to tip. */
  const seamTurns = (data: ReturnType<typeof generateTree>, b: SkeletonBranch) => {
    const out = seam(data, b);
    const axes = segments(b);
    let total = 0;
    for (let r = 1; r < out.length; r++) total += turnAbout(out[r - 1]!, out[r]!, axes[r - 1]!);
    return total;
  };

  it('rolls the bark seam (UVs and tube facets) one full turn per Twists, in the Spin direction', () => {
    for (const [spin, sign] of [['clockwise', 1], ['counterclockwise', -1]] as const) {
      for (const twists of [1, 3]) {
        const data = tree([barely({ spin, twists }), barely({ spin, twists: 2 })]);
        for (const b of data.skeleton.branches.filter((b) => b.level > 0)) {
          const expected = sign * (b.level === 1 ? twists : 2);
          expect(seamTurns(data, b), `${spin} ${b.path}`).toBeCloseTo(expected, 1);
        }
      }
    }
  });

  it('keeps unrolled bark on Snake, untwisted and Twist 0 branches', () => {
    for (const twist of [{}, { twist: 0.02, twists: 3 }, { twistStyle: 'corkscrew' as const, twist: 0, twists: 3 }]) {
      const data = tree([twist, twist]);
      for (const b of data.skeleton.branches.filter((b) => b.level > 0)) expect(Math.abs(seamTurns(data, b)), JSON.stringify(twist)).toBeLessThan(0.02);
    }
  });

  it('rolls the side branches around a Corkscrew parent with its bark', () => {
    for (const [spin, sign] of [['clockwise', 1], ['counterclockwise', -1]] as const) {
      const plain = tree([{ twist: 0 }, {}]);
      const data = tree([barely({ spin, twists: 3 }), {}]);
      const byPath = new Map(plain.skeleton.branches.map((b) => [b.path, b]));
      const children = onLevel(data, 2);
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        const before = plain.skeleton.branches.find((b) => b.path === child.path)!;
        const axis = tangentAt(byPath.get(child.parent!)!, child.attach);
        expect(wrapped(turnAbout(before.direction, child.direction, axis) - sign * 3 * child.attach), child.path).toBeCloseTo(0, 1);
      }
    }
  });

  it('rolls the leaves and Fruit around a Corkscrew branch with its bark', () => {
    const plain = tree([{}, { twist: 0 }]);
    const data = tree([{}, barely({ spin: 'clockwise', twists: 2 })]);
    const branches = new Map(plain.skeleton.branches.map((b) => [b.path, b]));
    for (const parts of ['leaves', 'fruit'] as const) {
      const before = new Map(plain.skeleton[parts].map((p) => [p.id, p]));
      expect(data.skeleton[parts].length).toBeGreaterThan(0);
      for (const part of data.skeleton[parts]) {
        const axis = tangentAt(branches.get(part.branch)!, part.attach);
        const was = before.get(part.id)!;
        const turned = turnAbout(was.direction, part.direction, axis);
        expect(wrapped(turned - 2 * part.attach), `${parts} ${part.id}`).toBeCloseTo(0, 1);
      }
    }
  });
});

describe('Follow Twist between Corkscrew branch levels', () => {
  const corkscrew = (more: Partial<BranchLevelDefinition> = {}): Partial<BranchLevelDefinition> => ({ twistStyle: 'corkscrew', twist: 0.6, twists: 2, ...more });
  const following = (more: Partial<BranchLevelDefinition> = {}) => corkscrew({ followTwist: true, ...more });
  /** Straight courses (no Bend, no Gravity), so without a Twist Curve each branch's course is its start direction. */
  const straight = (more: Partial<BranchLevelDefinition>[], seed = 5) =>
    generateTree(define(more.map((m, i) => ({ sections: i === 0 ? 2 : 7, bend: 0, gravity: 0, ...m }))), seed);
  const parentOf = (data: ReturnType<typeof generateTree>, b: SkeletonBranch) => data.skeleton.branches.find((p) => p.path === b.parent)!;

  it('takes the parent\'s Spin, ignoring its own', () => {
    const data = straight([corkscrew({ spin: 'clockwise' }), following({ spin: 'counterclockwise', twists: 3 })]);
    for (const b of onLevel(data, 2)) expect(Math.sign(turnsAround(b)), b.path).toBe(1);
    // With a Random Spin each branch turns the way its own parent does.
    const random = straight([corkscrew(), following({ twists: 3 })]);
    const signs = onLevel(random, 1).map((p) => Math.sign(turnsAround(p)));
    expect(signs).toContain(1);
    expect(signs).toContain(-1);
    for (const b of onLevel(random, 2)) expect(Math.sign(turnsAround(b)), b.path).toBe(Math.sign(turnsAround(parentOf(random, b))));
  });

  it('starts its spiral where the parent\'s spiral is at the attach point', () => {
    const data = straight([corkscrew({ twists: 3 }), following({ twist: 0.4, twists: 2 })]);
    for (const b of onLevel(data, 2)) {
      const parent = parentOf(data, b);
      const expected = carried(sideAt(parent, b.attach, 3), parent.direction, b.direction);
      expect(angleBetween(sideAt(b, 0, 2), expected), b.path).toBeLessThan(2);
    }
    // Without Follow Twist the Seed picks where each spiral starts.
    const own = straight([corkscrew({ twists: 3 }), corkscrew({ twist: 0.4, twists: 2 })]);
    const misses = onLevel(own, 2).map((b) => {
      const parent = parentOf(own, b);
      return angleBetween(sideAt(b, 0, 2), carried(sideAt(parent, b.attach, 3), parent.direction, b.direction));
    });
    expect(Math.max(...misses)).toBeGreaterThan(30);
  });

  it('bends its Twist Curve to the parent\'s curve side', () => {
    /** The axis a straight-course Corkscrew's Twist Curve turns it about: from its start to its end heading (a slight Twist barely leans it). */
    const curveAxisOf = (b: SkeletonBranch) => unit(cross(b.direction, segments(b).at(-1)!));
    const slight = { twist: 0.05, twistCurve: 0.6 };
    const check = (data: ReturnType<typeof generateTree>) =>
      onLevel(data, 2).map((b) => {
        const parent = parentOf(data, b);
        const axis = curveAxisOf(parent);
        const course = turned(parent.direction, axis, 0.6 * Math.PI * b.attach * b.attach * (3 - 2 * b.attach));
        return angleBetween(curveAxisOf(b), carried(axis, course, b.direction));
      });
    for (const miss of check(straight([corkscrew(slight), following({ ...slight, twistCurve: 0.5 })]))) expect(miss).toBeLessThan(8);
    expect(Math.max(...check(straight([corkscrew(slight), corkscrew({ ...slight, twistCurve: 0.5 })])))).toBeGreaterThan(30);
  });

  it('follows a Corkscrew trunk on the first level: each Stem\'s Spin, its spiral where they attach and its curve side', () => {
    /** Straight, leaning Stems (no Bend, no Trunk gravity) with first-level branches on them. */
    const onStems = (trunk: Partial<BranchLevelDefinition>, level: Partial<BranchLevelDefinition>) =>
      generateTree(define([{ sections: 2, bend: 0, gravity: 0, ...level }, {}], { schemaVersion: 3, trunk: { stems: 2, spread: 40, bend: 0, ...trunk } }), 5);
    const curveAxisOf = (b: SkeletonBranch) => unit(cross(b.direction, segments(b).at(-1)!));
    const spun = onStems(corkscrew({ twists: 3, spin: 'clockwise' }), following({ twist: 0.4, spin: 'counterclockwise' }));
    for (const b of onLevel(spun, 1)) {
      const stem = parentOf(spun, b);
      expect(Math.sign(turnsAround(b)), b.path).toBe(1);
      expect(angleBetween(sideAt(b, 0, 2), carried(sideAt(stem, b.attach, 3), stem.direction, b.direction)), b.path).toBeLessThan(2);
    }
    const slight = { twist: 0.05, twistCurve: 0.6 };
    const curved = onStems(corkscrew(slight), following({ ...slight, twistCurve: 0.5 }));
    for (const b of onLevel(curved, 1)) {
      const stem = parentOf(curved, b);
      const axis = curveAxisOf(stem);
      const course = turned(stem.direction, axis, 0.6 * Math.PI * b.attach * b.attach * (3 - 2 * b.attach));
      expect(angleBetween(curveAxisOf(b), carried(axis, course, b.direction)), b.path).toBeLessThan(8);
    }
  });

  it('keeps its own Twist, Twists and Twist Curve amounts', () => {
    const data = straight([corkscrew({ twist: 0.9, twists: 2, twistCurve: 0 }), following({ twist: 0.4, twists: 3, twistCurve: 0 })]);
    for (const b of onLevel(data, 2)) {
      expect(sectionsOf(b)).toBe(18);
      expect(Math.abs(turnsAround(b))).toBeGreaterThan(2.75);
      expect(Math.abs(turnsAround(b))).toBeLessThan(3.05);
      const lean = segments(b).map((d) => angleBetween(d, b.direction));
      for (const a of lean.slice(3)) expect(a, b.path).toBeCloseTo(0.4 * 45, 0);
    }
    const hooked = straight([corkscrew({ twist: 0.2, twistCurve: 0.3 }), following({ twist: 0.2, twistCurve: 1 })]);
    for (const b of onLevel(hooked, 2)) expect(angleBetween(segments(b).at(-1)!, b.direction), b.path).toBeGreaterThan(165);
  });

  it('does nothing with a Snake parent, a Snake child or Twist 0, or on the first level while the trunk does not corkscrew', () => {
    const cases: Partial<BranchLevelDefinition>[][] = [
      [{ twist: 0.6, twists: 2 }, corkscrew()],
      [corkscrew(), { twist: 0.5, twists: 3 }],
      [corkscrew({ twist: 0 }), corkscrew()],
      [corkscrew(), corkscrew({ twist: 0 })],
      [{}, corkscrew()],
    ];
    for (const [first, second] of cases) {
      const plain = grow([first!, second!]);
      const followed = grow([first!, { ...second, followTwist: true }]);
      expect(followed.skeleton, JSON.stringify([first, second])).toEqual(plain.skeleton);
      expect(hashTreeData(followed)).toBe(hashTreeData(plain));
    }
    // The first level follows the trunk, which does not corkscrew here (snaking or untwisted).
    for (const trunk of [{}, { twist: 0.5, twists: 3 }]) {
      const plain = generateTree(define([corkscrew(), {}], { schemaVersion: 3, trunk }), 5);
      const followed = generateTree(define([following(), {}], { schemaVersion: 3, trunk }), 5);
      expect(followed.skeleton).toEqual(plain.skeleton);
    }
    const off = grow([corkscrew({ followTwist: false }), corkscrew({ followTwist: false })]);
    expect(off.skeleton).toEqual(grow([corkscrew(), corkscrew()]).skeleton);
  });

  it('is Seed-bound: the same Seed gives the same tree, another Seed another', () => {
    const levels = [corkscrew({ twistCurve: 0.5 }), following({ twistCurve: 0.5 })];
    expect(straight(levels).skeleton).toEqual(straight(levels).skeleton);
    expect(hashTreeData(straight(levels))).toBe(hashTreeData(straight(levels)));
    expect(straight(levels, 6).skeleton).not.toEqual(straight(levels).skeleton);
  });
});
