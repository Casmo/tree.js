import { describe, expect, it } from 'vitest';
import { parseDefinition } from '../definition';
import { generateLightTree, generateTree, hashTreeData } from './index';

const massTree = (masses?: number) =>
  parseDefinition({
    schemaVersion: 2,
    leaves: { count: 20, shape: 'mass', size: 0.5, ...(masses === undefined ? {} : { masses }) },
  });

/** Distinct values of one component of a vec4 attribute. */
function distinct(array: Float32Array, itemSize: number, component: number): Set<number> {
  const out = new Set<number>();
  for (let i = component; i < array.length; i += itemSize) out.add(array[i]!);
  return out;
}

describe("leaf shape 'mass': Leaf Masses of spray cards (ADR 0014)", () => {
  it('draws every leaf as one square spray card (4 vertices, 2 triangles, full 0..1 UVs)', () => {
    const { skeleton, leaves } = generateTree(massTree(), 3);
    const n = skeleton.leaves.length;
    expect(n).toBeGreaterThan(50);
    expect(leaves.positions.length).toBe(n * 4 * 3);
    expect(leaves.indices.length).toBe(n * 6);
    expect(Array.from(leaves.uvs.slice(0, 8))).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it('groups the cards into `leaves.masses` Leaf Masses (one paint random per mass)', () => {
    for (const masses of [3, 6]) {
      const { leaves } = generateTree(massTree(masses), 3);
      expect(distinct(leaves.attributes.aPaint!.array, 4, 3).size).toBe(masses);
    }
  });

  it('gives each vertex the outward normal of its Leaf Mass (aMass) and paint values in 0..1 (aPaint)', () => {
    const { leaves, crown } = generateTree(massTree(), 3);
    const mass = leaves.attributes.aMass!.array;
    const paint = leaves.attributes.aPaint!.array;
    let outward = 0;
    const count = leaves.positions.length / 3;
    for (let v = 0; v < count; v++) {
      const n = [mass[v * 3]!, mass[v * 3 + 1]!, mass[v * 3 + 2]!];
      expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 4);
      const away = [0, 1, 2].map((a) => leaves.positions[v * 3 + a]! - crown.center[a]!);
      if (n[0]! * away[0]! + n[1]! * away[1]! + n[2]! * away[2]! > 0) outward++;
      for (let c = 0; c < 4; c++) {
        expect(paint[v * 4 + c]).toBeGreaterThanOrEqual(0);
        expect(paint[v * 4 + c]).toBeLessThanOrEqual(1);
      }
    }
    // Masses sit around the crown's centre, so most of their normals point out of the crown.
    expect(outward / count).toBeGreaterThan(0.7);
  });

  it('paints the bottom of the crown low and the top high (aPaint.x = height in the crown)', () => {
    const { leaves } = generateTree(massTree(), 3);
    const paint = leaves.attributes.aPaint!.array;
    const count = leaves.positions.length / 3;
    const ys = Array.from({ length: count }, (_, v) => leaves.positions[v * 3 + 1]!);
    const low = ys.indexOf(Math.min(...ys));
    const high = ys.indexOf(Math.max(...ys));
    expect(paint[low * 4]).toBeLessThan(0.1);
    expect(paint[high * 4]).toBeGreaterThan(0.9);
  });

  it('is deterministic, and the Light Detail Level draws Leaf Masses too', () => {
    expect(hashTreeData(generateTree(massTree(), 7))).toBe(hashTreeData(generateTree(massTree(), 7)));
    const light = generateLightTree(massTree(), 7);
    expect(light.leaves.attributes.aPaint).toBeDefined();
    expect(light.leaves.positions.length).toBe(light.skeleton.leaves.length * 4 * 3);
  });
});
