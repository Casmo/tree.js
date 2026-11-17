import { describe, expect, it } from 'vitest';
import { parseDefinition } from '../definition';
import { generateTree, type GeometryBuffers } from '../generator';
import { growPositions } from './index';

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

  it('grows taller, sprouts first-level branches before second-level ones, and brings leaves last', () => {
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
    expect(first('level2')).toBeLessThan(first('leaves'));
    expect(steps[2]!.leaves).toBe(0); // none at Growth 0.4
    expect(steps[5]!.leaves).toBe(data.skeleton.leaves.length);
  });
});
