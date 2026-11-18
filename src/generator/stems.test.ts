import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, TreeDefinitionError, type DefinitionPatch } from '../definition';
import { generateTree, hashTreeData, trunkHeight, type SkeletonBranch } from './index';

const DEG = 180 / Math.PI;
const base = parseDefinition({ schemaVersion: 3, branches: [{ count: 4 }, { count: 2 }], leaves: { count: 3 } });
const grow = (trunk: DefinitionPatch['trunk'], seed = 5) => generateTree(extendDefinition(base, { trunk }), seed);
const stemsOf = (data: ReturnType<typeof generateTree>) => data.skeleton.branches.filter((b) => b.parent === null);
/** Angle of a Stem's base direction from vertical, degrees. */
const tiltOf = (b: SkeletonBranch) => Math.acos(b.direction[1]) * DEG;
const tip = (b: SkeletonBranch) => b.points[b.points.length - 1]!.position;

describe('Stems', () => {
  it('grows the declared number of Stems, paths "0", "1", ..., each with the full branch structure', () => {
    const one = grow({ stems: 1 });
    const three = grow({ stems: 3 });
    expect(stemsOf(three).map((b) => b.path)).toEqual(['0', '1', '2']);
    const perStem = (data: ReturnType<typeof generateTree>, stem: string) =>
      data.skeleton.branches.filter((b) => b.path === stem || b.path.startsWith(`${stem}.`));
    for (const stem of ['0', '1', '2']) {
      const branches = perStem(three, stem);
      expect(branches.length).toBe(one.skeleton.branches.length);
      expect(branches.map((b) => b.path)).toEqual(one.skeleton.branches.map((b) => b.path.replace(/^0/, stem)));
      expect(three.skeleton.leaves.filter((l) => l.branch.split('.')[0] === stem).length).toBe(one.skeleton.leaves.length);
    }
    // Stems first, then breadth first over all Stems.
    const levels = three.skeleton.branches.map((b) => b.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });

  it('stands the Stems in a small ring at the base, leaning out by the spread angle (with Seed variation)', () => {
    const data = grow({ stems: 4, spread: 20 });
    const stems = stemsOf(data);
    const centre = stems.map((s) => s.points[0]!.position).reduce((a, p) => [a[0] + p[0] / 4, 0, a[2] + p[2] / 4], [0, 0, 0]);
    for (const stem of stems) {
      const [x, y, z] = stem.points[0]!.position;
      expect(y).toBe(0);
      const r = Math.hypot(x - centre[0], z - centre[2]);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(base.trunk.radius * 3);
      expect(tiltOf(stem)).toBeGreaterThan(20 * 0.6);
      expect(tiltOf(stem)).toBeLessThan(20 * 1.4);
      // Leans outward: the tip is further from the ring centre than the base.
      const [tx, , tz] = tip(stem);
      expect(Math.hypot(tx - centre[0], tz - centre[2])).toBeGreaterThan(r + 0.5);
    }
    // Different Seeds lean the Stems differently; the same Seed always the same.
    expect(stemsOf(grow({ stems: 4, spread: 20 }, 6)).map(tiltOf)).not.toEqual(stems.map(tiltOf));
    expect(stemsOf(grow({ stems: 4, spread: 20 })).map(tiltOf)).toEqual(stems.map(tiltOf));
    expect(hashTreeData(grow({ stems: 4, spread: 20 }))).toBe(hashTreeData(data));
  });

  it('spread 0 keeps every Stem upright', () => {
    for (const stem of stemsOf(grow({ stems: 3, spread: 0 }))) expect(tiltOf(stem)).toBeCloseTo(0, 6);
  });

  it('a single Stem with default fields is exactly today\'s trunk (paths and hashes)', () => {
    const plain = generateTree(base, 5);
    const explicit = grow({ stems: 1, spread: 0, gravity: 0 });
    expect(explicit.skeleton).toEqual(plain.skeleton);
    expect(hashTreeData(explicit)).toBe(hashTreeData(plain));
    // The fields are optional: absent means one upright Stem without gravity.
    expect(base.trunk).not.toHaveProperty('stems');
  });

  it('Sculpts work on a second Stem ("1...") and leave the first one alone', () => {
    const def = extendDefinition(base, { trunk: { stems: 2, spread: 15 } });
    const plain = generateTree(def, 5);
    const sculpted = generateTree(extendDefinition(def, { sculpts: [{ seed: 5, path: '1.2', action: 'delete' }] }), 5);
    const gone = (p: string) => p === '1.2' || p.startsWith('1.2.');
    expect(sculpted.skeleton.branches).toEqual(plain.skeleton.branches.filter((b) => !gone(b.path)));
    const moved = generateTree(
      extendDefinition(def, { sculpts: [{ seed: 5, path: '1', action: 'move', rotation: [0, 0, 0.4], scale: 1 }] }),
      5,
    );
    const changed = moved.skeleton.branches.filter((b, i) => JSON.stringify(b) !== JSON.stringify(plain.skeleton.branches[i]));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((b) => b.path === '1' || b.path.startsWith('1.'))).toBe(true);
  });

  it('validates stems (integer >= 1) and spread (0..90 degrees)', () => {
    for (const trunk of [{ stems: 0 }, { stems: 1.5 }, { spread: -1 }, { spread: 91 }]) {
      expect(() => parseDefinition({ schemaVersion: 3, trunk })).toThrow(TreeDefinitionError);
    }
  });
});

describe('trunk gravity (the leader)', () => {
  const straight = { bend: 0, lengthVariation: 0, sections: 9 };

  it('bends only the upper part of the Stem; the lower trunk is unchanged', () => {
    const plain = stemsOf(grow(straight))[0]!;
    const nodding = stemsOf(grow({ ...straight, gravity: -1 }))[0]!;
    const length = plain.points[plain.points.length - 1]!.position[1];
    plain.points.forEach((p, i) => {
      if (p.position[1] <= length * 0.6) expect(nodding.points[i]).toEqual(p);
    });
    // The leader nods: its tip drops below the straight tip and swings sideways.
    const [x, y, z] = tip(nodding);
    expect(y).toBeLessThan(length * 0.95);
    expect(Math.hypot(x, z)).toBeGreaterThan(length * 0.1);
  });

  it('pulls a leaning Stem back up with positive gravity', () => {
    const leaning = stemsOf(grow({ ...straight, spread: 30 }))[0]!;
    const upright = stemsOf(grow({ ...straight, spread: 30, gravity: 1 }))[0]!;
    const lean = (b: SkeletonBranch) => {
      const [x0, y0, z0] = b.points[b.points.length - 2]!.position;
      const [x1, y1, z1] = tip(b);
      return Math.atan2(Math.hypot(x1 - x0, z1 - z0), y1 - y0) * DEG;
    };
    expect(lean(upright)).toBeLessThan(lean(leaning) - 10);
  });

  it('gravity 0 leaves the tree identical', () => {
    expect(hashTreeData(grow({ gravity: 0 }))).toBe(hashTreeData(generateTree(base, 5)));
  });

  it('validates gravity (-1..1)', () => {
    for (const gravity of [-1.5, 2]) expect(() => parseDefinition({ schemaVersion: 3, trunk: { gravity } })).toThrow(TreeDefinitionError);
  });
});

describe('several Stems: Wind, Growth and Bake scale', () => {
  const data = grow({ stems: 3, spread: 25, lengthVariation: 0.3 });
  const tallest = Math.max(...stemsOf(data).flatMap((s) => s.points.map((p) => p.position[1])));

  it('trunkHeight is the tallest Stem', () => {
    expect(trunkHeight(data.skeleton)).toBe(tallest);
  });

  it('trunk sway rises to 1 only at the top of the tallest Stem, on every Stem', () => {
    const { aWind, aLevel } = data.wood.attributes;
    let max = 0;
    for (let v = 0; v < aLevel.array.length; v++) {
      if (aLevel.array[v] !== 0) continue;
      const expected = Math.min(Math.max(data.wood.positions[v * 3 + 1]! / tallest, 0), 1) ** 2;
      expect(aWind.array[v * 3]).toBeCloseTo(expected, 5);
      max = Math.max(max, aWind.array[v * 3]!);
    }
    expect(max).toBeGreaterThan(0.95);
  });

  it('every Stem is there from Growth 0; its branches sprout later', () => {
    data.skeleton.branches.forEach((b, i) => {
      if (b.parent === null) expect(data.growth.branches[i]).toEqual({ start: 0, end: 0 });
      else expect(data.growth.branches[i]!.start).toBeGreaterThan(0);
    });
  });
});
