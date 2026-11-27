import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAF_GROWTH_START, extendDefinition, parseDefinition, type TreeDefinition } from '../definition';
import { generateLightTree, generateTree, type GeometryBuffers, type TreeData } from '../generator';
import { hashBytes } from '../random';
import { birch, oak, spruce } from '../species';
import painterly from '../styles/painterly';
import realistic from '../styles/realistic';
import { growPositions, treeScale } from './index';
import { withoutTipBranches } from '../../test/definitions';

const def = parseDefinition({ schemaVersion: 2 });
const data = generateTree(def, 4);

const height = (positions: Float32Array) => {
  let max = 0;
  for (let i = 1; i < positions.length; i += 3) max = Math.max(max, positions[i]!);
  return max;
};

/** Number of leaf cards with a non-zero size. */
function visibleLeaves(buffers: GeometryBuffers, positions: Float32Array): number {
  let visible = 0;
  for (let l = 0; l < buffers.positions.length / 12; l++) {
    const base = positions.subarray(l * 12, l * 12 + 3);
    const tip = positions.subarray(l * 12 + 6, l * 12 + 9);
    if (Math.hypot(tip[0]! - base[0]!, tip[1]! - base[1]!, tip[2]! - base[2]!) > 1e-6) visible++;
  }
  return visible;
}

/** Number of wood vertices (of the given levels) that are not collapsed onto their part's base point. */
function grownWoodVertices(positions: Float32Array, level: (l: number) => boolean): number {
  const { aOrigin, aLevel } = data.wood.attributes;
  const firstOfPart = new Map<string, number>();
  let n = 0;
  for (let v = 0; v < aLevel.array.length; v++) {
    if (!level(aLevel.array[v]!)) continue;
    const key = `${aLevel.array[v]}:${aOrigin.array.subarray(v * 3, v * 3 + 3).join()}`;
    const first = firstOfPart.get(key) ?? v;
    firstOfPart.set(key, first);
    const d = [0, 1, 2].map((k) => positions[v * 3 + k]! - positions[first * 3 + k]!);
    if (Math.hypot(...d) > 1e-5) n++;
  }
  return n;
}

describe('growPositions (Growth evaluated on the CPU, twin of the TSL graph)', () => {
  it('leaves a tree at Growth 1 exactly as generated (a normal static tree)', () => {
    expect(growPositions(data.wood, 1)).toEqual(data.wood.positions);
    expect(growPositions(data.leaves, 1)).toEqual(data.leaves.positions);
  });

  it('is a small, slender sapling at Growth 0: only the trunk, no branches, no leaves', () => {
    const wood = growPositions(data.wood, 0);
    expect(height(wood)).toBeGreaterThan(0);
    expect(height(wood)).toBeLessThan(height(data.wood.positions) * 0.3);
    expect(grownWoodVertices(wood, (l) => l > 0)).toBe(0);
    expect(visibleLeaves(data.leaves, growPositions(data.leaves, 0))).toBe(0);
    // Slender: the trunk base is thinner relative to the height than when fully grown.
    const baseRadius = (p: Float32Array) => Math.hypot(p[0]!, p[2]!);
    expect(baseRadius(wood) / height(wood)).toBeLessThan((baseRadius(data.wood.positions) / height(data.wood.positions)) * 0.6);
  });

  it('grows taller, sprouts first-level branches before second-level ones, and brings leaves on the outermost twigs', () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map((g) => ({
      height: height(growPositions(data.wood, g)),
      level1: grownWoodVertices(growPositions(data.wood, g), (l) => l === 1),
      level2: grownWoodVertices(growPositions(data.wood, g), (l) => l === 2),
      leaves: visibleLeaves(data.leaves, growPositions(data.leaves, g)),
    }));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.height).toBeGreaterThan(steps[i - 1]!.height);
      expect(steps[i]!.level1).toBeGreaterThanOrEqual(steps[i - 1]!.level1);
      expect(steps[i]!.leaves).toBeGreaterThanOrEqual(steps[i - 1]!.leaves);
    }
    const first = (key: 'level1' | 'level2' | 'leaves') => steps.findIndex((s) => s[key] > 0);
    expect(first('level1')).toBeLessThan(first('level2'));
    expect(first('level2')).toBeLessThanOrEqual(first('leaves'));
    expect(steps[2]!.leaves).toBeGreaterThan(0); // leafy already at Growth 0.4
    expect(steps[5]!.leaves).toBe(data.skeleton.leaves.length);
  });
});

// --- The leaf model (Leaf Start, ADR 0020): measured on grown geometry only ---------------------------

type Vec = [number, number, number];
const at = (p: ArrayLike<number>, v: number): Vec => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The leaf curve of the spec, with an independent (spelled out) easing: 1 - (1 - p)^2. */
const curveAt = (g: number, start: number) => {
  const p = Math.min(Math.max(start >= 1 ? (g >= 1 ? 1 : 0) : (g - start) / (1 - start), 0), 1);
  return 1 - (1 - p) * (1 - p);
};

/**
 * Each leaf of `data` at Growth `g`, read off the grown leaf vertices: a leaf is a uniformly scaled copy of
 * itself, so its size is the ratio of its extent to its generated extent, and its grown attachment point
 * the image of the generated one under the same scaling.
 */
function grownLeaves(data: TreeData, g: number): { size: number; base: Vec }[] {
  const grown = growPositions(data.leaves, g);
  const per = data.leaves.positions.length / 3 / data.skeleton.leaves.length;
  return data.skeleton.leaves.map((leaf, l) => {
    const first = l * per;
    let far = first;
    for (let v = first; v < first + per; v++) if (dist(at(data.leaves.positions, v), at(data.leaves.positions, first)) > dist(at(data.leaves.positions, far), at(data.leaves.positions, first))) far = v;
    const size = dist(at(grown, first), at(grown, far)) / dist(at(data.leaves.positions, first), at(data.leaves.positions, far));
    const g0 = at(grown, first);
    const f0 = at(data.leaves.positions, first);
    const base = [0, 1, 2].map((k) => g0[k]! + (leaf.position[k]! - f0[k]!) * size) as Vec;
    return { size, base };
  });
}

/** A branch's centre line as grown at `g`: the centres of its rings of grown wood vertices, base to tip. */
function grownCentreLine(data: TreeData, path: string, g: number, grown = growPositions(data.wood, g)): Vec[] {
  const branch = data.skeleton.branches.find((b) => b.path === path)!;
  const { aOrigin, aLevel, aAlong } = data.wood.attributes;
  // Each ring's distinct vertices (a ring repeats its seam vertex for the UVs), by `aAlong`.
  const rings = new Map<number, Map<string, Vec>>();
  for (let v = 0; v < aLevel.array.length; v++) {
    if (aLevel.array[v] !== branch.level) continue;
    if (dist(at(aOrigin.array, v), branch.points[0]!.position) > 1e-6) continue;
    const along = aAlong.array[v]!;
    const ring = rings.get(along) ?? new Map<string, Vec>();
    ring.set(at(data.wood.positions, v).join(), at(grown, v));
    rings.set(along, ring);
  }
  return [...rings.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ring]) => [...ring.values()])
    .map((ps) => [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k]!, 0) / ps.length) as Vec);
}

/** Distance from `p` to a polyline. */
function toLine(p: Vec, line: Vec[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1]!, line[i]!];
    const ab = [0, 1, 2].map((k) => b[k]! - a[k]!);
    const len2 = ab.reduce((s, x) => s + x * x, 0);
    const t = len2 > 0 ? Math.min(Math.max(ab.reduce((s, x, k) => s + x * (p[k]! - a[k]!), 0) / len2, 0), 1) : 0;
    best = Math.min(best, dist(p, [0, 1, 2].map((k) => a[k]! + ab[k]! * t) as Vec));
  }
  return line.length === 1 ? dist(p, line[0]!) : best;
}

const lineLength = (line: Vec[]) => line.slice(1).reduce((s, p, i) => s + dist(p, line[i]!), 0);

const VISIBLE = 1e-6;
const visibleShare = (data: TreeData, g: number) => grownLeaves(data, g).filter((l) => l.size > VISIBLE).length / data.skeleton.leaves.length;

describe('the leaf model: leaves ride on their growing twig from Leaf Start', () => {
  // Growth by which most leaves show: as soon as most outermost twigs are out (an oak's sprout last, ≈0.45-0.55).
  const species = { oak: [oak, 0.6], spruce: [spruce, 0.5], birch: [birch, 0.5] } as const;
  for (const [name, [s, leafy]] of Object.entries(species)) {
    const definition = parseDefinition(realistic.apply(s));
    const data = generateTree(definition, 7);

    describe(name, () => {
      it(`shows no leaves below Leaf Start, leaves from Growth 0.5 (most by ${leafy}), and every leaf as generated at Growth 1`, () => {
        expect(data.skeleton.leaves.length).toBeGreaterThan(0);
        for (const g of [0, 0.05, 0.1]) expect(visibleShare(data, g)).toBe(0);
        expect(visibleShare(data, 0.5)).toBeGreaterThan(0);
        expect(visibleShare(data, leafy)).toBeGreaterThan(0.5);
        expect(growPositions(data.leaves, 1)).toEqual(data.leaves.positions);
      });

      it("keeps every visible leaf's attachment point on its twig as grown at that Growth (it never floats)", () => {
        for (const g of [0.3, 0.45, 0.6, 0.8]) {
          const wood = growPositions(data.wood, g);
          const leaves = grownLeaves(data, g);
          const lines = new Map<string, Vec[]>();
          data.skeleton.leaves.forEach((leaf, l) => {
            if (leaves[l]!.size <= VISIBLE) return;
            if (!lines.has(leaf.branch)) lines.set(leaf.branch, grownCentreLine(data, leaf.branch, g, wood));
            expect(toLine(leaves[l]!.base, lines.get(leaf.branch)!)).toBeLessThan(1e-3);
          });
        }
      });

      it("keeps a leaf's size within the leaf curve times its twig's progress, and lets leaves only grow with Growth", () => {
        const start = definition.leaves.growthStart ?? DEFAULT_LEAF_GROWTH_START;
        const full = new Map(data.skeleton.branches.map((b) => [b.path, lineLength(grownCentreLine(data, b.path, 1))]));
        let previous = grownLeaves(data, 0).map((l) => l.size);
        for (const g of [0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1]) {
          const wood = growPositions(data.wood, g);
          const sizes = grownLeaves(data, g).map((l) => l.size);
          const twig = new Map<string, number>();
          data.skeleton.leaves.forEach((leaf, l) => {
            if (!twig.has(leaf.branch)) twig.set(leaf.branch, lineLength(grownCentreLine(data, leaf.branch, g, wood)) / full.get(leaf.branch)!);
            expect(sizes[l]!).toBeLessThanOrEqual(curveAt(g, start) * twig.get(leaf.branch)! + 1e-5);
            expect(sizes[l]!).toBeGreaterThanOrEqual(previous[l]! - 1e-6);
          });
          previous = sizes;
        }
      });
    });
  }

  it('moves the first leaves with leaves.growthStart: 0.8 shows none at 0.5, 1 shows them only at Growth 1', () => {
    const late = generateTree(extendDefinition(parseDefinition(realistic.apply(oak)), { leaves: { growthStart: 0.8 } }), 7);
    expect(visibleShare(late, 0.5)).toBe(0);
    expect(visibleShare(late, 0.8)).toBe(0);
    expect(visibleShare(late, 0.95)).toBeGreaterThan(0);
    const last = generateTree(extendDefinition(parseDefinition(realistic.apply(oak)), { leaves: { growthStart: 1 } }), 7);
    expect(visibleShare(last, 0.999)).toBe(0);
    expect(growPositions(last.leaves, 1)).toEqual(last.leaves.positions);
  });

  it('staggers leaves by Seed and attach within variation.growth, so trees of one Definition differ', () => {
    const definition = extendDefinition(parseDefinition(realistic.apply(birch)), { variation: { growth: 0.2 } });
    const start = definition.leaves.growthStart ?? DEFAULT_LEAF_GROWTH_START;
    const a = generateTree(definition, 1);
    const b = generateTree(definition, 2);
    const starts = a.growth.leaves.map((w) => w.start);
    for (const w of a.growth.leaves) {
      expect(w.start).toBeGreaterThanOrEqual(start);
      expect(w.start).toBeLessThanOrEqual(start + 0.2 * (1 - start) + 1e-9);
      expect(w.end).toBe(1);
    }
    expect(new Set(starts).size).toBeGreaterThan(starts.length / 2); // not in lockstep
    // Leaves near the twig base start a little earlier on average.
    const byAttach = a.skeleton.leaves.map((leaf, l) => [leaf.attach, starts[l]!] as const).sort((x, y) => x[0] - y[0]);
    const mean = (xs: readonly (readonly [number, number])[]) => xs.reduce((s, x) => s + x[1], 0) / xs.length;
    expect(mean(byAttach.slice(0, byAttach.length / 2))).toBeLessThan(mean(byAttach.slice(byAttach.length / 2)));
    // Two trees of one Definition leaf out differently.
    const share = (d: TreeData) => grownLeaves(d, 0.5).reduce((s, l) => s + l.size, 0) / d.skeleton.leaves.length;
    expect(share(a)).not.toBeCloseTo(share(b), 3);
  });

  it('leaves the wood exactly as before at every Growth (golden hashes of the grown wood)', () => {
    // The painterly oak's were re-recorded when Painterly resized its trees for Tip Branches (ADR 0013), and again
    // when Tip Branches came to every branch level (ADR 0021): Painterly sizes a tree by its height with them.
    const golden: [string, TreeDefinition, (d: TreeDefinition, seed: number) => TreeData, string][] = [
      ['oak', realistic.apply(oak), generateTree, 'a1ecf30e'],
      ['oak light', realistic.apply(oak), generateLightTree, '5bb7b820'],
      ['spruce', realistic.apply(spruce), generateTree, '25a52c94'],
      ['spruce light', realistic.apply(spruce), generateLightTree, 'd22f8d94'],
      ['birch', realistic.apply(birch), generateTree, '9483abf7'],
      ['birch light', realistic.apply(birch), generateLightTree, 'a956b5e6'],
      ['painterly oak', painterly.apply(oak), generateTree, '3307b0ed'],
      ['painterly oak light', painterly.apply(oak), generateLightTree, '2a585b46'],
    ];
    for (const [name, definition, generate, hash] of golden) {
      // Without Tip Branches (ADR 0019), which came later and add wood.
      const data = generate(parseDefinition(withoutTipBranches(definition)), 7);
      let h: number | undefined;
      for (const g of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) h = hashBytes(new Uint8Array(growPositions(data.wood, g).buffer), h);
      expect(h!.toString(16), name).toBe(hash);
    }
  });

  it('grows Leaf Masses with the same Leaf Start and curve', () => {
    const definition = parseDefinition(painterly.apply(birch));
    expect(definition.leaves.shape).toBe('mass');
    const data = generateTree(definition, 7);
    const start = definition.leaves.growthStart ?? DEFAULT_LEAF_GROWTH_START;
    expect(visibleShare(data, start)).toBe(0);
    expect(visibleShare(data, 0.5)).toBeGreaterThan(0.25);
    for (const g of [0.3, 0.5, 0.8]) for (const l of grownLeaves(data, g)) expect(l.size).toBeLessThanOrEqual(curveAt(g, start) * treeScale(g) + 1e-5);
    expect(growPositions(data.leaves, 1)).toEqual(data.leaves.positions);
  });

  it('grows the leaves of the Light Detail Level with the same leaf timing', () => {
    const definition = parseDefinition(realistic.apply(birch));
    const light = generateLightTree(definition, 7);
    const start = definition.leaves.growthStart ?? DEFAULT_LEAF_GROWTH_START;
    for (const w of light.growth.leaves) {
      expect(w.start).toBeGreaterThanOrEqual(start);
      expect(w.end).toBe(1);
    }
    expect(visibleShare(light, start)).toBe(0);
    expect(visibleShare(light, 0.5)).toBeGreaterThan(0.25);
    // The Light wood is swept from fewer sections, so a leaf sits only near its coarse twig; growing it never moves it further off.
    const offAt = (g: number) => {
      const leaves = grownLeaves(light, g);
      return light.skeleton.leaves.map((leaf, l) => (leaves[l]!.size > VISIBLE ? toLine(leaves[l]!.base, grownCentreLine(light, leaf.branch, g)) : 0));
    };
    const full = offAt(1);
    for (const g of [0.3, 0.6]) offAt(g).forEach((off, l) => expect(off).toBeLessThanOrEqual(full[l]! + 1e-4));
  });
});

describe('the Light Detail Level grows its leaves like Full (switching detail level while growing does not pop)', () => {
  const meanSize = (data: TreeData, g: number) => grownLeaves(data, g).reduce((s, l) => s + l.size, 0) / data.skeleton.leaves.length;
  for (const [name, s] of Object.entries({ oak, spruce, birch })) {
    it(`${name}: about the same share of leaves shows, at about the same size, at every Growth`, () => {
      const definition = parseDefinition(realistic.apply(s));
      const full = generateTree(definition, 7);
      const light = generateLightTree(definition, 7);
      for (const g of [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) {
        expect(Math.abs(visibleShare(light, g) - visibleShare(full, g)), `visible share at ${g}`).toBeLessThan(0.25);
        expect(Math.abs(meanSize(light, g) - meanSize(full, g)), `mean size at ${g}`).toBeLessThan(0.05);
      }
    });
  }
});
