// Painterly compresses tree heights (ADR 0013): every Species is scaled uniformly so its fully grown
// height maps from its real height (over the catalogue) into 2-4 m, keeping the order between Species.
import { describe, expect, it } from 'vitest';
import { parseDefinition, type TreeDefinition } from '../../src/index';
import { generateTree } from '../../src/generator';
import { SPECIES_BY_NAME, SPECIES_NAMES } from '../../src/species';
import painterly from '../../src/styles/painterly';
import realistic from '../../src/styles/realistic';
import lowPoly from '../../src/styles/low-poly';
import { CATALOGUE_HEIGHTS, scaleDefinition } from '../../src/styles/painterly/height';

const SEEDS = [1, 7, 42];

/** Top of the grown tree (wood, leaves and Fruit), metres. */
function top(definition: TreeDefinition, seed: number): number {
  const data = generateTree(parseDefinition(definition), seed);
  let y = 0;
  for (const { positions } of [data.wood, data.leaves, data.fruit]) for (let i = 1; i < positions.length; i += 3) y = Math.max(y, positions[i]!);
  return y;
}
const meanTop = (definition: TreeDefinition) => SEEDS.reduce((sum, seed) => sum + top(definition, seed), 0) / SEEDS.length;

// The two catalogue-wide tests generate every Species for several Seeds (Tip Branches add wood): slow on CI runners.
describe('Painterly height compression (ADR 0013)', () => {
  const painted = Object.fromEntries(SPECIES_NAMES.map((id) => [id, painterly.apply(SPECIES_BY_NAME[id])]));

  it('grows every Species to 2-4 m at full Growth, for every Seed', { timeout: 30_000 }, () => {
    for (const id of SPECIES_NAMES) {
      for (const seed of SEEDS) {
        const height = top(painted[id]!, seed);
        expect(height, `${id} seed ${seed}`).toBeGreaterThanOrEqual(2);
        expect(height, `${id} seed ${seed}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('keeps the order: the lowest Species (juniper, with its Tip Branches) at the bottom of the range, the tallest (redwood) at the top', { timeout: 30_000 }, () => {
    const heights = Object.fromEntries(SPECIES_NAMES.map((id) => [id, meanTop(painted[id]!)]));
    const sorted = [...SPECIES_NAMES].sort((a, b) => heights[a]! - heights[b]!);
    expect(sorted[0]).toBe('juniper');
    expect(sorted.at(-1)).toBe('redwood');
    expect(Math.abs(heights.juniper! - 2.2)).toBeLessThan(0.15);
    expect(Math.abs(heights.redwood! - 3.8)).toBeLessThan(0.15);
    // Real heights: the same Species drawn in a real-sized Style. Clearly different heights keep their order.
    const real = Object.fromEntries(SPECIES_NAMES.map((id) => [id, meanTop(realistic.apply(SPECIES_BY_NAME[id]))]));
    for (const a of SPECIES_NAMES) {
      for (const b of SPECIES_NAMES) {
        if (real[a]! > real[b]! * 1.15) expect(heights[a], `${a} taller than ${b}`).toBeGreaterThan(heights[b]!);
      }
    }
  });

  it('a Species taller than any in the catalogue still stays within 4 m', () => {
    const giant = { ...SPECIES_BY_NAME.redwood, id: 'giant', trunk: { ...SPECIES_BY_NAME.redwood.trunk, length: 40, radius: 2.5 } };
    for (const seed of SEEDS) expect(top(painterly.apply(giant), seed)).toBeLessThanOrEqual(4);
  });

  it('scales uniformly: radii, Fruit and Roots keep their proportions to the trunk', () => {
    const { oak } = SPECIES_BY_NAME;
    const { trunk, fruit, roots, branches } = painted.oak!;
    expect(trunk.length).toBeLessThan(oak.trunk.length / 2);
    expect(trunk.radius / trunk.length).toBeCloseTo(oak.trunk.radius / oak.trunk.length, 6);
    expect(fruit!.size / trunk.length).toBeCloseTo(oak.fruit!.size / oak.trunk.length, 6);
    expect(roots).toMatchObject(oak.roots!);
    expect(branches.map(({ length, radius }) => ({ length, radius }))).toEqual(oak.branches.map(({ length, radius }) => ({ length, radius })));
  });
});

describe('Painterly size in Tree Definitions', () => {
  const oak = painterly.apply(SPECIES_BY_NAME.oak);

  it('a Painterly Definition carries the small size, in any Style it is drawn in later', () => {
    const height = meanTop(oak);
    expect(meanTop(realistic.apply(oak))).toBeCloseTo(height, 0);
    expect(realistic.apply(oak).trunk).toMatchObject({ length: oak.trunk.length, radius: oak.trunk.radius });
  });

  it('re-applying Painterly keeps the size (no shrinking twice, also via another Style)', () => {
    expect(painterly.apply(oak).trunk.length).toBe(oak.trunk.length);
    expect(painterly.apply(realistic.apply(oak)).trunk.length).toBe(oak.trunk.length);
    expect(painterly.apply(painterly.broadleaf).trunk).toEqual(painterly.broadleaf.trunk);
  });

  it('keeps the order for any height: a 3.9 m tree ends no taller than a 4.2 m one', () => {
    // Juniper drawn in Painterly before scaling is CATALOGUE_HEIGHTS.min tall (checked above): scale it to
    // trees that are 3.9 m and 4.2 m tall as Painterly measures them, from a real-sized (realistic) Definition.
    const real = realistic.apply(SPECIES_BY_NAME.juniper);
    const low = scaleDefinition(real, 3.9 / CATALOGUE_HEIGHTS.min);
    const high = scaleDefinition(real, 4.2 / CATALOGUE_HEIGHTS.min);
    const [paintedLow, paintedHigh] = [meanTop(painterly.apply(low)), meanTop(painterly.apply(high))];
    expect(paintedLow).toBeLessThanOrEqual(paintedHigh + 1e-6);
    expect(paintedHigh).toBeGreaterThanOrEqual(2);
    expect(paintedHigh).toBeLessThanOrEqual(4);
  });

  it('a Painterly Definition drawn in another Style and back keeps its size (round trip)', () => {
    for (const style of [realistic, lowPoly]) {
      const back = painterly.apply(style.apply(oak));
      expect(back.trunk).toMatchObject({ length: oak.trunk.length, radius: oak.trunk.radius });
      expect(meanTop(back)).toBeCloseTo(meanTop(oak), 1);
    }
    expect(painterly.apply(realistic.apply(painterly.conifer)).trunk).toMatchObject({ length: painterly.conifer.trunk.length, radius: painterly.conifer.trunk.radius });
  });

  it('a real-sized Definition from another Style shrinks to its Painterly height', () => {
    const real = realistic.apply(SPECIES_BY_NAME.redwood);
    expect(meanTop(real)).toBeGreaterThan(14);
    const height = meanTop(painterly.apply(real));
    expect(height).toBeGreaterThan(3.5);
    expect(height).toBeLessThan(4);
  });
});

describe('scaleDefinition (the uniform scale)', () => {
  it('grows exactly the same tree, every point (wood, leaves, Fruit, Roots) scaled by the factor', () => {
    const oak = realistic.apply(SPECIES_BY_NAME.oak, { materials: { bark: { groundTint: { color: '#554433', height: 0.6, strength: 0.5 } } } });
    const small = scaleDefinition(oak, 0.3);
    expect(small.materials.bark.groundTint?.height).toBeCloseTo(0.18, 6);
    for (const seed of SEEDS) {
      const big = generateTree(parseDefinition(oak), seed);
      const tree = generateTree(parseDefinition(small), seed);
      expect(tree.skeleton.roots.length).toBeGreaterThan(0);
      for (const part of ['wood', 'leaves', 'fruit'] as const) {
        const [a, b] = [big[part].positions, tree[part].positions];
        expect(b.length, part).toBe(a.length);
        expect(b.length, part).toBeGreaterThan(0);
        let worst = 0;
        for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(b[i]! - a[i]! * 0.3));
        expect(worst, `${part} seed ${seed}`).toBeLessThan(1e-4);
      }
    }
  });
});
