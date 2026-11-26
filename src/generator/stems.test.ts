import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, TreeDefinitionError, type DefinitionPatch } from '../definition';
import { generateTree, hashTreeData, trunkHeight, type SkeletonBranch, type Vec3 } from './index';

const DEG = 180 / Math.PI;
const base = parseDefinition({ schemaVersion: 3, branches: [{ count: 4 }, { count: 2 }], leaves: { count: 3 } });
const grow = (trunk: DefinitionPatch['trunk'], seed = 5) => generateTree(extendDefinition(base, { trunk }), seed);
const stemsOf = (data: ReturnType<typeof generateTree>) => data.skeleton.branches.filter((b) => b.parent === null);
/** Angle of a Stem's base direction from vertical, degrees. */
const tiltOf = (b: SkeletonBranch) => Math.acos(b.direction[1]) * DEG;
const tip = (b: SkeletonBranch) => b.points[b.points.length - 1]!.position;
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

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

describe('Twist on the trunk', () => {
  const straight = { bend: 0, lengthVariation: 0, sections: 4 };
  const unit = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const angleBetween = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * DEG;
  /** The unit direction of every segment of a Stem's centre line. */
  const segments = (b: SkeletonBranch) =>
    b.points.slice(1).map((p, i) => unit([p.position[0] - b.points[i]!.position[0], p.position[1] - b.points[i]!.position[1], p.position[2] - b.points[i]!.position[2]]));

  it('Twist 0 or absent gives exactly today\'s trunk (skeleton and geometry hash)', () => {
    const plain = generateTree(base, 5);
    for (const trunk of [{ twist: 0 }, { twist: 0, twists: 7 }, { stems: 1, twist: 0, twists: 1 }]) {
      const data = grow(trunk);
      expect(data.skeleton).toEqual(plain.skeleton);
      expect(hashTreeData(data)).toBe(hashTreeData(plain));
    }
  });

  it('builds a twisted Stem with max(Sections, 3 × Twists) Sections; Twists is 2 while absent', () => {
    const sectionsOf = (trunk: DefinitionPatch['trunk']) => stemsOf(grow(trunk)).map((b) => b.points.length - 1);
    expect(sectionsOf({ sections: 4, twist: 0.5 })).toEqual([6]);
    expect(sectionsOf({ sections: 9, twist: 0.5 })).toEqual([9]);
    expect(sectionsOf({ sections: 4, twist: 0.5, twists: 4, stems: 3 })).toEqual([12, 12, 12]);
    expect(sectionsOf({ sections: 4, twists: 4 })).toEqual([4]);
  });

  it('leaves its straight upright course smoothly, with the base in place and starting upright', () => {
    const plainStem = stemsOf(grow(straight))[0]!;
    for (const twists of [1, 2, 3]) {
      const stem = stemsOf(grow({ ...straight, twist: 1, twists }))[0]!;
      expect(stem.points[0]).toEqual(plainStem.points[0]);
      expect(stem.direction).toEqual([0, 1, 0]);
      const dirs = segments(stem);
      // The first Section grows straight up; then the Stem swings away from upright and back.
      expect(angleBetween(dirs[0]!, [0, 1, 0])).toBeLessThan(1e-9);
      const away = Math.max(...dirs.map((d) => angleBetween(d, [0, 1, 0])));
      expect(away).toBeGreaterThan(20);
      expect(away).toBeLessThan(46);
      // No kinks: above the upright base Section (which turns out by at most one swing), neighbouring
      // segments differ by at most about two thirds of a 45° swing.
      expect(angleBetween(dirs[0]!, dirs[1]!)).toBeLessThan(46);
      for (let i = 2; i < dirs.length; i++) expect(angleBetween(dirs[i - 1]!, dirs[i]!)).toBeLessThan(31);
      // It stays a trunk: the tip still stands well above the base.
      expect(tip(stem)[1]).toBeGreaterThan(tip(plainStem)[1] * 0.8);
    }
  });

  it('swings the full Twist at every turn, even on 3 Sections per turn, and ends back near its course', () => {
    for (const twists of [2, 3]) {
      // Sections 4 → 3 × Twists: 3 Sections per turn.
      const dirs = segments(stemsOf(grow({ ...straight, twist: 1, twists }))[0]!);
      expect(dirs).toHaveLength(3 * twists);
      for (let turn = 0; turn < twists; turn++) {
        const away = dirs.slice(3 * turn, 3 * turn + 3).map((d) => angleBetween(d, [0, 1, 0]));
        // Twist 1 ≈ 45° at every turn, not two thirds of it.
        expect(Math.max(...away)).toBeGreaterThan(44);
        expect(Math.max(...away)).toBeLessThan(46);
      }
      // The top Section heads back towards the upright course rather than ending turned away.
      expect(angleBetween(dirs.at(-1)!, [0, 1, 0])).toBeLessThan(20);
    }
  });

  it("keeps Bend exact: every corner of the bent centre line stays on a barely twisted Stem's centre line", () => {
    for (const [sections, twists] of [[4, 2], [4, 3], [3, 3], [5, 4]] as const) {
      const bent = { bend: 0.4, lengthVariation: 0, sections };
      const corners = stemsOf(grow(bent))[0]!.points.map((p) => p.position);
      const points = stemsOf(grow({ ...bent, twist: 1e-9, twists }))[0]!.points.map((p) => p.position);
      expect(points).toHaveLength(Math.max(sections, 3 * twists) + 1);
      for (const corner of corners) {
        const nearest = Math.min(...points.map((p) => Math.hypot(...sub3(p, corner))));
        expect(nearest, `${sections} Sections, ${twists} Twists`).toBeLessThan(1e-6);
      }
    }
  });

  it('lets Trunk gravity and the Stem lean still apply to a twisted Stem', () => {
    const twist = { ...straight, sections: 9, twist: 0.6, twists: 3 };
    // Trunk gravity nods the twisted leader over: its tip drops well below the twisted tip without gravity.
    const upright = stemsOf(grow(twist))[0]!;
    const nodding = stemsOf(grow({ ...twist, gravity: -1 }))[0]!;
    expect(tip(nodding)[1]).toBeLessThan(tip(upright)[1] - 0.1 * tip(upright)[1]);
    // The lower trunk stays as the Twist made it.
    upright.points.slice(0, 7).forEach((p, i) => expect(nodding.points[i]).toEqual(p));
    // The lean tilts the whole twisted Stem: base direction and overall course lean out by the spread.
    const leaning = stemsOf(grow({ ...twist, spread: 30 }))[0]!;
    expect(tiltOf(leaning)).toBeGreaterThan(30 * 0.6);
    const [x, y, z] = sub3(tip(leaning), leaning.points[0]!.position);
    expect(Math.atan2(Math.hypot(x, z), y) * DEG).toBeGreaterThan(10);
    const first = segments(leaning)[0]!;
    expect(angleBetween(first, leaning.direction)).toBeLessThan(1e-9);
  });

  it('twists each Stem of a multi-Stem tree differently; the same Seed gives the same trunk', () => {
    const trunk = { ...straight, stems: 3, twist: 0.7, twists: 2 };
    const data = grow(trunk);
    expect(grow(trunk).skeleton).toEqual(data.skeleton);
    expect(hashTreeData(grow(trunk))).toBe(hashTreeData(data));
    // Each Stem's own snake: how its segments swing away from upright differs (no copies).
    const snakes = stemsOf(data).map((stem) => segments(stem).map((d) => angleBetween(d, [0, 1, 0]).toFixed(3) + d.map((v) => v.toFixed(3)).join()).join('|'));
    expect(new Set(snakes).size).toBe(3);
    // Another Seed twists the Stems differently.
    expect(stemsOf(grow(trunk, 6)).map((b) => segments(b))).not.toEqual(stemsOf(data).map((b) => segments(b)));
  });

  it('only reshapes the Stems: branch counts, paths, attach fractions, leaves and Sculpt targets stay', () => {
    const def = extendDefinition(base, { trunk: { stems: 2, spread: 15 } });
    const plain = generateTree(def, 5);
    for (const trunk of [{ twist: 0.4, twists: 1 }, { twist: 1, twists: 8 }]) {
      const data = generateTree(extendDefinition(def, { trunk }), 5);
      expect(data.skeleton.branches.map((b) => [b.path, b.attach, b.level])).toEqual(plain.skeleton.branches.map((b) => [b.path, b.attach, b.level]));
      expect(data.skeleton.leaves.map((l) => [l.id, l.branch, l.attach])).toEqual(plain.skeleton.leaves.map((l) => [l.id, l.branch, l.attach]));
      const sculpted = generateTree(extendDefinition(def, { trunk, sculpts: [{ seed: 5, path: '1.2', action: 'delete' }] }), 5);
      const gone = (p: string) => p === '1.2' || p.startsWith('1.2.');
      expect(sculpted.skeleton.branches.map((b) => b.path)).toEqual(data.skeleton.branches.map((b) => b.path).filter((p) => !gone(p)));
    }
  });
});

describe('Corkscrew on the trunk', () => {
  const straight = { bend: 0, lengthVariation: 0, sections: 4 };
  const corkscrew = (twist: number, twists: number, more: DefinitionPatch['trunk'] = {}): DefinitionPatch['trunk'] => ({ ...straight, twistStyle: 'corkscrew', twist, twists, ...more });
  const unit = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
  const angleBetween = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * DEG;
  const segments = (b: SkeletonBranch) => b.points.slice(1).map((p, i) => unit(sub3(p.position, b.points[i]!.position)));
  const UP: Vec3 = [0, 1, 0];
  /** Signed angle (turns) from `a` to `b` around unit `axis`, both made perpendicular to it: positive clockwise seen looking along `axis`. */
  const turnAbout = (a: Vec3, b: Vec3, axis: Vec3) => {
    const [x, y] = [a, b].map((v) => sub3(v, scale(axis, dot(v, axis))));
    return Math.atan2(dot(cross(x!, y!), axis), dot(x!, y!)) / (2 * Math.PI);
  };
  /** How many times an upright Stem's segments go round straight up, signed: positive clockwise seen from its base. */
  const turnsAround = (b: SkeletonBranch) => {
    const dirs = segments(b);
    let total = 0;
    for (let i = 1; i < dirs.length; i++) total += turnAbout(dirs[i - 1]!, dirs[i]!, UP);
    return total;
  };

  it('builds a Corkscrew Stem with max(Sections, 6 × Twists) Sections; Twist 0 and a written-out Snake change nothing', () => {
    const sectionsOf = (trunk: DefinitionPatch['trunk']) => stemsOf(grow(trunk)).map((b) => b.points.length - 1);
    expect(sectionsOf(corkscrew(0.5, 2))).toEqual([12]);
    expect(sectionsOf(corkscrew(0.5, 2, { sections: 15 }))).toEqual([15]);
    expect(sectionsOf(corkscrew(0.5, 3, { stems: 3, twistCurve: 1 }))).toEqual([18, 18, 18]);
    const plain = generateTree(base, 5);
    for (const trunk of [{ twistStyle: 'corkscrew' as const, twistCurve: 1, spin: 'clockwise' as const }, { twistStyle: 'corkscrew' as const, twist: 0, twists: 5 }]) {
      const data = grow(trunk);
      expect(data.skeleton).toEqual(plain.skeleton);
      expect(hashTreeData(data)).toBe(hashTreeData(plain));
    }
    const snake = { twist: 0.7, twists: 3, stems: 2 };
    const written = grow({ ...snake, twistStyle: 'snake', spin: 'counterclockwise', twistCurve: 0.8 });
    expect(written.skeleton).toEqual(grow(snake).skeleton);
    expect(hashTreeData(written)).toBe(hashTreeData(grow(snake)));
  });

  it('keeps its base in place and starts upright, then spirals around its course: Twist × 45° off it, Twists full turns in the Spin direction', () => {
    const plainStem = stemsOf(grow(straight))[0]!;
    for (const [spin, sign] of [['clockwise', 1], ['counterclockwise', -1]] as const) {
      for (const [twist, twists] of [[1, 2], [0.5, 3]] as const) {
        const stem = stemsOf(grow(corkscrew(twist, twists, { spin })))[0]!;
        expect(stem.points[0]).toEqual(plainStem.points[0]);
        expect(stem.direction).toEqual(UP);
        const dirs = segments(stem);
        expect(angleBetween(dirs[0]!, UP)).toBeLessThan(1e-9);
        // Past the ease-in (the first half turn) it leans steadily by Twist × 45°.
        for (const d of dirs.slice(4)) expect(angleBetween(d, UP), `${spin} ${twist}`).toBeCloseTo(twist * 45, 0);
        const turns = turnsAround(stem);
        expect(Math.sign(turns), spin).toBe(sign);
        // Sampled from the middle of the second Section (the base one grows upright) to the middle of the
        // last: on 6 Sections per turn that is a third of a turn short of Twists.
        expect(Math.abs(turns)).toBeCloseTo(twists - 1 / 3, 6);
        // No kinks: never more than the steady step of a 45° lean on 6 Sections per turn (≈ 41°).
        const steps = dirs.slice(1).map((d, i) => angleBetween(dirs[i]!, d));
        for (const step of steps) expect(step).toBeLessThan(42);
        for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]! - steps[i - 1]!)).toBeLessThan(25);
      }
    }
  });

  it('turns its heading by Twist Curve × 180°, eased in and out without kinks; 0 ends heading up', () => {
    const endHeading = (twistCurve: number) => angleBetween(segments(stemsOf(grow(corkscrew(0.2, 2, { twistCurve })))[0]!).at(-1)!, UP);
    // The lean of Twist 0.2 is 9° off the course.
    expect(endHeading(0)).toBeLessThan(10);
    expect(endHeading(0.5)).toBeGreaterThan(75);
    expect(endHeading(0.5)).toBeLessThan(105);
    expect(endHeading(1)).toBeGreaterThan(165);
    const dirs = segments(stemsOf(grow(corkscrew(1, 3, { twistCurve: 1 })))[0]!);
    expect(angleBetween(dirs[0]!, UP)).toBeLessThan(1e-9);
    const steps = dirs.slice(1).map((d, i) => angleBetween(dirs[i]!, d));
    for (const step of steps) expect(step).toBeLessThan(60);
    for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i]! - steps[i - 1]!)).toBeLessThan(30);
  });

  it('lets Trunk gravity, the Stem lean and the ring offset still apply on top', () => {
    const twist = corkscrew(0.6, 2, { sections: 9, twistCurve: 0.3 });
    const upright = stemsOf(grow(twist))[0]!;
    const nodding = stemsOf(grow({ ...twist, gravity: -1 }))[0]!;
    expect(tip(nodding)[1]).toBeLessThan(tip(upright)[1] - 0.1 * tip(upright)[1]);
    // The lower trunk stays as the Corkscrew made it.
    upright.points.slice(0, 9).forEach((p, i) => expect(nodding.points[i]).toEqual(p));
    const leaning = stemsOf(grow({ ...twist, spread: 30 }))[0]!;
    expect(tiltOf(leaning)).toBeGreaterThan(30 * 0.6);
    expect(angleBetween(segments(leaning)[0]!, leaning.direction)).toBeLessThan(1e-9);
    // Several Stems stand on the same ring as untwisted ones, with the same leans.
    const ring = { stems: 3, spread: 15 };
    const plain = stemsOf(grow({ ...straight, ...ring }));
    stemsOf(grow({ ...twist, ...ring })).forEach((stem, i) => {
      expect(stem.points[0]).toEqual(plain[i]!.points[0]);
      expect(stem.direction).toEqual(plain[i]!.direction);
    });
  });

  it('twists each Stem on its own: its own Random Spin and curve side, Seed-bound', () => {
    const trunk = corkscrew(0.5, 2, { stems: 4 });
    const data = grow(trunk);
    expect(grow(trunk).skeleton).toEqual(data.skeleton);
    expect(hashTreeData(grow(trunk))).toBe(hashTreeData(data));
    const spins = [5, 6, 7].flatMap((seed) => stemsOf(grow(trunk, seed)).map((s) => Math.sign(turnsAround(s))));
    expect(spins).toContain(1);
    expect(spins).toContain(-1);
    // The side each upright Stem's Twist Curve bends to (azimuth of its end heading), degrees.
    const sides = stemsOf(grow(corkscrew(0.2, 2, { stems: 4, twistCurve: 0.5, spin: 'clockwise' }))).map((s) => {
      const [x, , z] = segments(s).at(-1)!;
      return Math.atan2(z, x) * DEG;
    });
    const apart = (a: number, b: number) => 180 - Math.abs(180 - Math.abs(a - b));
    expect(Math.max(...sides.flatMap((a) => sides.map((b) => apart(a, b))))).toBeGreaterThan(90);
    expect(stemsOf(grow(trunk, 6)).map(segments)).not.toEqual(stemsOf(data).map(segments));
  });

  it('rolls its bark and the branches on it one full turn per Twists, in the Spin direction (ADR 0016); a Snake Stem does not roll', () => {
    expect(stemsOf(grow({ ...straight, twist: 0.6, twists: 3 }))[0]!.roll).toBeUndefined();
    for (const [spin, sign] of [['clockwise', 1], ['counterclockwise', -1]] as const) {
      // Barely twisted (the lean is under 1°), so what is measured is the roll of the frames, not the path.
      const data = grow(corkscrew(0.02, 3, { spin }));
      expect(stemsOf(data)[0]!.roll).toBeCloseTo(sign * 2 * Math.PI * 3, 9);
      const plain = grow({ ...straight, sections: 18 });
      const before = new Map(plain.skeleton.branches.map((b) => [b.path, b]));
      const children = data.skeleton.branches.filter((b) => b.level === 1);
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        const turned = turnAbout(before.get(child.path)!.direction, child.direction, UP);
        expect(turned - sign * 3 * child.attach - Math.round(turned - sign * 3 * child.attach), child.path).toBeCloseTo(0, 1);
      }
    }
  });

  it('only reshapes the Stems: branch counts, paths, attach fractions, leaves and Sculpt targets stay', () => {
    const def = extendDefinition(base, { trunk: { stems: 2, spread: 15 } });
    const plain = generateTree(def, 5);
    const data = generateTree(extendDefinition(def, { trunk: { twistStyle: 'corkscrew', twist: 0.8, twists: 3, twistCurve: 0.6 } }), 5);
    expect(data.skeleton.branches.map((b) => [b.path, b.attach, b.level])).toEqual(plain.skeleton.branches.map((b) => [b.path, b.attach, b.level]));
    expect(data.skeleton.leaves.map((l) => [l.id, l.branch, l.attach])).toEqual(plain.skeleton.leaves.map((l) => [l.id, l.branch, l.attach]));
  });
});
