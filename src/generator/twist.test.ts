import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, type BranchLevelDefinition, type TreeDefinitionInput } from '../definition';
import { generateTree, hashTreeData, type SkeletonBranch, type Vec3 } from './index';

const DEG = 180 / Math.PI;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const angleBetween = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * DEG;
/** The unit direction of every segment of a branch's centre line. */
const segments = (b: SkeletonBranch) => b.points.slice(1).map((p, i) => unit(sub(p.position, b.points[i]!.position)));
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
const onLevel = (data: ReturnType<typeof generateTree>, level: number) => data.skeleton.branches.filter((b) => b.level === level);
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
      return unit(sub(side, scaled(b.direction, side[0] * b.direction[0] + side[1] * b.direction[1] + side[2] * b.direction[2])));
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
    const mean = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;
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

const scaled = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const crossed = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotted = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/**
 * How many times a straight-course branch's segments go round its start direction, signed: positive
 * clockwise seen from its base looking along it (right-handed about the direction), negative counter-clockwise.
 */
function turnsAround(b: SkeletonBranch): number {
  const sides = segments(b).map((d) => sub(d, scaled(b.direction, dotted(d, b.direction))));
  let total = 0;
  for (let i = 1; i < sides.length; i++) total += Math.atan2(dotted(crossed(sides[i - 1]!, sides[i]!), b.direction), dotted(sides[i - 1]!, sides[i]!));
  return total / (2 * Math.PI);
}

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
      const steps = dirs.slice(1).map((d, i) => angleBetween(dirs[i]!, d));
      // Never more than the steady step of a 45° lean on 6 Sections per turn (≈ 41°).
      for (const step of steps) expect(step).toBeLessThan(42);
      for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]! - steps[i - 1]!)).toBeLessThan(25);
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
    const mean = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;
    const flat = mean(heights(0));
    expect(mean(heights(-1))).toBeLessThan(flat - 0.1);
    expect(mean(heights(1))).toBeGreaterThan(flat + 0.1);
    const tips = (bend: number) => onLevel(grow([corkscrew(0.6, 3, { bend, gravity: 0 })]), 1).map(tipOf);
    const bent = tips(0.4);
    tips(0).forEach((tip, i) => expect(Math.hypot(...sub(tip, bent[i]!))).toBeGreaterThan(0.01));
  });
});
