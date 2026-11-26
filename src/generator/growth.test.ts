import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition } from '../definition';
import { generateTree } from './index';

const def = parseDefinition({ schemaVersion: 2 });

describe('Growth timing (per part)', () => {
  const data = generateTree(def, 3);
  /** Parts with their Growth window (TreeData.growth is parallel to the skeleton arrays). */
  const timed = (d: typeof data) => ({
    branches: d.skeleton.branches.map((b, i) => ({ ...b, growth: d.growth.branches[i]! })),
    leaves: d.skeleton.leaves.map((l, i) => ({ ...l, growth: d.growth.leaves[i]! })),
  });
  const { branches, leaves } = timed(data);
  const byPath = new Map(branches.map((b) => [b.path, b]));

  it('gives every part a window 0 <= start <= end <= 1, and the trunk is there from Growth 0', () => {
    expect(data.growth.branches.length).toBe(data.skeleton.branches.length);
    expect(data.growth.leaves.length).toBe(data.skeleton.leaves.length);
    const parts = [...branches, ...leaves];
    for (const { growth } of parts) {
      expect(growth.start).toBeGreaterThanOrEqual(0);
      expect(growth.end).toBeGreaterThanOrEqual(growth.start);
      expect(growth.end).toBeLessThanOrEqual(1);
    }
    expect(byPath.get('0')!.growth).toEqual({ start: 0, end: 0 });
    // The last part finishes exactly at Growth 1: no dead time at the end.
    expect(Math.max(...parts.map((p) => p.growth.end))).toBeCloseTo(1, 6);
  });

  it('sprouts branches in order: a branch starts only once its parent is fully grown, lower siblings first', () => {
    for (const branch of branches) {
      if (!branch.parent) continue;
      const parent = byPath.get(branch.parent)!;
      expect(branch.growth.start).toBeGreaterThanOrEqual(parent.growth.end);
    }
    // Without Seed timing variation, a lower sibling never starts after a higher one.
    const exact = generateTree(extendDefinition(def, { variation: { growth: 0 } }), 3);
    const siblings = timed(exact).branches.filter((b) => b.parent === '0').sort((a, b) => a.attach - b.attach);
    for (let i = 1; i < siblings.length; i++) {
      expect(siblings[i]!.growth.start).toBeGreaterThanOrEqual(siblings[i - 1]!.growth.start);
    }
  });

  it('unfolds leaves from Leaf Start (0.1 by default) to Growth 1, without waiting for their twig', () => {
    for (const leaf of leaves) {
      expect(leaf.growth.start).toBeGreaterThanOrEqual(0.1);
      expect(leaf.growth.end).toBe(1);
    }
    expect(leaves.some((leaf) => leaf.growth.start < byPath.get(leaf.branch)!.growth.end)).toBe(true);
    const late = generateTree(extendDefinition(def, { leaves: { growthStart: 0.7 } }), 3);
    for (const w of late.growth.leaves) expect(w.start).toBeGreaterThanOrEqual(0.7);
    // Leaf Start moves only the leaves: the branches keep their windows.
    expect(late.growth.branches).toEqual(data.growth.branches);
  });

  it("lets the Seed shift timing only within the Definition's variation.growth range", () => {
    const still = generateTree(extendDefinition(def, { variation: { growth: 0 } }), 5);
    const varied = generateTree(extendDefinition(def, { variation: { growth: 0.1 } }), 5);
    expect(varied.wood.positions).toEqual(still.wood.positions); // shape is not affected
    const a = [...still.growth.branches, ...still.growth.leaves];
    const b = [...varied.growth.branches, ...varied.growth.leaves];
    let maxShift = 0;
    a.forEach((w, i) => {
      maxShift = Math.max(maxShift, Math.abs(w.start - b[i]!.start), Math.abs(w.end - b[i]!.end));
    });
    expect(maxShift).toBeGreaterThan(0);
    expect(maxShift).toBeLessThanOrEqual(0.1);
  });
});

describe('aGrowth attribute', () => {
  const data = generateTree(def, 8);
  for (const [mesh, buffers] of [
    ['wood', data.wood],
    ['leaves', data.leaves],
  ] as const) {
    it(`${mesh}: one (start, end, radius) per vertex, within range`, () => {
      const { aGrowth } = buffers.attributes;
      expect(aGrowth.itemSize).toBe(3);
      expect(aGrowth.array.length).toBe(buffers.positions.length);
      for (let v = 0; v < aGrowth.array.length / 3; v++) {
        const [start, end, radius] = aGrowth.array.subarray(v * 3, v * 3 + 3);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThanOrEqual(start!);
        expect(end).toBeLessThanOrEqual(1);
        expect(radius).toBeGreaterThanOrEqual(0);
        if (mesh === 'leaves') expect(radius).toBe(0);
        else expect(radius).toBeLessThanOrEqual(def.trunk.radius + 1e-6);
      }
    });
  }
});

describe('aGrowth on solid leaf shapes', () => {
  for (const shape of ['clump', 'needle'] as const) {
    it(`${shape}: every leaf vertex carries its leaf's Growth window (from Leaf Start) and its twig's`, () => {
      const data = generateTree(extendDefinition(def, { leaves: { shape } }), 2);
      const { aGrowth, aTwigGrowth, aTwigOrigin } = data.leaves.attributes;
      expect(aGrowth.array.length).toBe(data.leaves.positions.length);
      expect(aTwigGrowth!.array.length).toBe((data.leaves.positions.length / 3) * 2);
      expect(aTwigOrigin!.array.length).toBe(data.leaves.positions.length);
      for (let v = 0; v < aGrowth.array.length / 3; v++) {
        expect(aGrowth.array[v * 3]).toBeGreaterThanOrEqual(0.1);
        expect(aGrowth.array[v * 3 + 1]).toBe(1);
        expect(aTwigGrowth!.array[v * 2]).toBeLessThanOrEqual(aTwigGrowth!.array[v * 2 + 1]!);
      }
      // The wood carries no twig attributes.
      expect(data.wood.attributes.aTwigGrowth).toBeUndefined();
    });
  }
});
