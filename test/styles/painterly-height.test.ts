// Painterly compresses tree heights (ADR 0013): every Species is scaled uniformly so its fully grown
// height maps from its real height (over the catalogue) into 2-4 m, keeping the order between Species.
import { describe, expect, it } from 'vitest';
import { parseDefinition, type TreeDefinition } from '../../src/index';
import { generateTree } from '../../src/generator';
import { SPECIES_BY_NAME, SPECIES_NAMES } from '../../src/species';
import painterly from '../../src/styles/painterly';
import realistic from '../../src/styles/realistic';

const SEEDS = [1, 7, 42];

/** Top of the grown tree (wood, leaves and Fruit), metres. */
function top(definition: TreeDefinition, seed: number): number {
  const data = generateTree(parseDefinition(definition), seed);
  let y = 0;
  for (const { positions } of [data.wood, data.leaves, data.fruit]) for (let i = 1; i < positions.length; i += 3) y = Math.max(y, positions[i]!);
  return y;
}
const meanTop = (definition: TreeDefinition) => SEEDS.reduce((sum, seed) => sum + top(definition, seed), 0) / SEEDS.length;

describe('Painterly height compression (ADR 0013)', () => {
  const painted = Object.fromEntries(SPECIES_NAMES.map((id) => [id, painterly.apply(SPECIES_BY_NAME[id])]));

  it('grows every Species to 2-4 m at full Growth, for every Seed', () => {
    for (const id of SPECIES_NAMES) {
      for (const seed of SEEDS) {
        const height = top(painted[id]!, seed);
        expect(height, `${id} seed ${seed}`).toBeGreaterThanOrEqual(2);
        expect(height, `${id} seed ${seed}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('keeps the order: the lowest Species (peach) at the bottom of the range, the tallest (redwood) at the top', () => {
    const heights = Object.fromEntries(SPECIES_NAMES.map((id) => [id, meanTop(painted[id]!)]));
    const sorted = [...SPECIES_NAMES].sort((a, b) => heights[a]! - heights[b]!);
    expect(sorted[0]).toBe('peach');
    expect(sorted.at(-1)).toBe('redwood');
    expect(Math.abs(heights.peach! - 2.2)).toBeLessThan(0.15);
    expect(Math.abs(heights.redwood! - 3.8)).toBeLessThan(0.15);
    // Real heights: the same Species drawn in a real-sized Style. Clearly different heights keep their order.
    const real = Object.fromEntries(SPECIES_NAMES.map((id) => [id, meanTop(realistic.apply(SPECIES_BY_NAME[id]))]));
    for (const a of SPECIES_NAMES) {
      for (const b of SPECIES_NAMES) {
        if (real[a]! > real[b]! * 1.15) expect(heights[a], `${a} taller than ${b}`).toBeGreaterThan(heights[b]!);
      }
    }
  });
});
