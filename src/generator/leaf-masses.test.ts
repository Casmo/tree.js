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

  it('sways each Leaf Mass as one: every card of a mass has the same branch sway, so Wind never tears a mass apart (#116)', () => {
    const { leaves } = generateTree(massTree(), 3);
    const paint = leaves.attributes.aPaint!.array;
    const wind = leaves.attributes.aWind!.array;
    const sway = new Map<number, Set<number>>();
    for (let v = 0; v < leaves.positions.length / 3; v++) {
      const mass = paint[v * 4 + 3]!;
      if (!sway.has(mass)) sway.set(mass, new Set());
      sway.get(mass)!.add(wind[v * 3 + 1]!);
    }
    for (const values of sway.values()) expect(values.size).toBe(1);
    // ... but the masses still sway with their branches (more out on the twigs than at the trunk).
    const perMass = [...sway.values()].map((values) => [...values][0]!);
    expect(Math.min(...perMass)).toBeGreaterThan(0);
    // Leaf flutter stays per card: 0 at its base, 1 at its tip.
    expect(distinct(wind, 3, 2)).toEqual(new Set([0, 1]));
  });

  it('turns the outside of each Leaf Mass first through the year: warm autumn tips over a greener inside (#116)', () => {
    const definition = parseDefinition({ ...massTree(), variation: { color: 0.1, growth: 0.1, season: 0 } }); // no Season variation of its own
    const { leaves } = generateTree(definition, 3);
    const paint = leaves.attributes.aPaint!.array;
    const shift = leaves.attributes.aSeason!.array;
    const outer: number[] = [];
    const inner: number[] = [];
    for (let card = 0; card < leaves.positions.length / 12; card++) {
      const v = card * 4;
      // One timing per card (all four corners), within a few days of the tree's.
      for (let c = 1; c < 4; c++) expect(shift[(v + c) * 3]).toBe(shift[v * 3]);
      // Never behind the tree: in early spring an inner card must not wrap back into the end of winter.
      expect(shift[v * 3]).toBeGreaterThanOrEqual(0);
      expect(shift[v * 3]).toBeLessThanOrEqual(0.06);
      const tipLight = paint[v * 4 + 2]!; // at the card's base: how far out in its mass the card sits
      if (tipLight > 0.5) outer.push(shift[v * 3]!);
      else if (tipLight < 0.4) inner.push(shift[v * 3]!);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(outer.length).toBeGreaterThan(20);
    expect(inner.length).toBeGreaterThan(20);
    expect(mean(outer) - mean(inner)).toBeGreaterThan(0.015);
  });

  it('is deterministic, and the Light Detail Level draws Leaf Masses too', () => {
    expect(hashTreeData(generateTree(massTree(), 7))).toBe(hashTreeData(generateTree(massTree(), 7)));
    const light = generateLightTree(massTree(), 7);
    expect(light.leaves.attributes.aPaint).toBeDefined();
    expect(light.leaves.positions.length).toBe(light.skeleton.leaves.length * 4 * 3);
  });

  it('with `leaves.massLayering` > 1 groups the leaves into wide, flat masses stacked in layers (conifers)', () => {
    // A tall, narrow crown: whorls of level branches up a long trunk.
    const conifer = (massLayering?: number) =>
      parseDefinition({
        schemaVersion: 2,
        trunk: { length: 4 },
        branches: [{ count: 20, start: 0.2, end: 1, angle: 90, length: 0.3 }],
        leaves: { count: 30, shape: 'mass', size: 0.4, masses: 8, ...(massLayering === undefined ? {} : { massLayering }) },
      });
    const flatness = (massLayering?: number) => {
      const { leaves } = generateTree(conifer(massLayering), 3);
      const paint = leaves.attributes.aPaint!.array;
      const byMass = new Map<number, number[][]>();
      for (let v = 0; v < leaves.positions.length / 3; v++) {
        const points = byMass.get(paint[v * 4 + 3]!) ?? [];
        points.push([0, 1, 2].map((a) => leaves.positions[v * 3 + a]!));
        byMass.set(paint[v * 4 + 3]!, points);
      }
      // Mean over the masses of (vertical spread / horizontal spread) of their card corners.
      const sd = (values: number[]) => {
        const mean = values.reduce((s, x) => s + x, 0) / values.length;
        return Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length);
      };
      const ratios = [...byMass.values()].map((p) => sd(p.map((q) => q[1]!)) / Math.hypot(sd(p.map((q) => q[0]!)), sd(p.map((q) => q[2]!))));
      return ratios.reduce((s, x) => s + x, 0) / ratios.length;
    };
    expect(flatness(1)).toBeCloseTo(flatness(), 10); // 1 = the default (round masses)
    expect(flatness(2)).toBeLessThan(flatness() * 0.8);
  });
});
