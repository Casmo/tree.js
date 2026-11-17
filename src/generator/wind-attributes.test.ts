import { describe, expect, it } from 'vitest';
import { parseDefinition } from '../definition';
import { generateTree, type GeometryBuffers } from './index';

const def = parseDefinition({
  schemaVersion: 2,
  branches: [{ count: 5 }, { count: 3, start: 0.2 }, { count: 2, start: 0.3 }],
  leaves: { count: 4 },
});
const data = generateTree(def, 3);

/** Per-vertex view of the Wind weights: [trunk sway, branch sway, leaf flutter]. */
function weights(buffers: GeometryBuffers) {
  const { aWind, aLevel, aAlong, aOrigin } = buffers.attributes;
  return Array.from({ length: aLevel.array.length }, (_, v) => ({
    trunk: aWind.array[v * 3]!,
    branch: aWind.array[v * 3 + 1]!,
    leaf: aWind.array[v * 3 + 2]!,
    level: aLevel.array[v]!,
    along: aAlong.array[v]!,
    y: buffers.positions[v * 3 + 1]!,
    origin: [...aOrigin.array.subarray(v * 3, v * 3 + 3)].join(),
  }));
}

describe('per-vertex Wind attributes (aWind = trunk sway, branch sway, leaf flutter)', () => {
  for (const [mesh, buffers] of [
    ['wood', data.wood],
    ['leaves', data.leaves],
  ] as const) {
    it(`${mesh}: aWind is a vec3 per vertex with every weight within 0..1`, () => {
      const { aWind } = buffers.attributes;
      expect(aWind.itemSize).toBe(3);
      expect(aWind.array.length).toBe(buffers.positions.length);
      for (const x of aWind.array) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    });
  }

  it('the trunk is pinned at the ground and sways most at its top', () => {
    const trunk = weights(data.wood).filter((w) => w.level === 0);
    for (const w of trunk.filter((w) => w.along === 0)) expect(w.trunk).toBeCloseTo(0, 5);
    for (const w of trunk.filter((w) => w.along === 1)) expect(w.trunk).toBeGreaterThan(0.9);
    const byHeight = [...trunk].sort((a, b) => a.y - b.y);
    for (let i = 1; i < byHeight.length; i++) expect(byHeight[i]!.trunk).toBeGreaterThanOrEqual(byHeight[i - 1]!.trunk);
  });

  it('branch sway is 0 on the trunk and grows from each branch base to its tip', () => {
    const wood = weights(data.wood);
    for (const w of wood.filter((w) => w.level === 0)) expect(w.branch).toBe(0);
    const byBranch = new Map<string, ReturnType<typeof weights>>();
    for (const w of wood.filter((w) => w.level > 0)) byBranch.set(w.origin, [...(byBranch.get(w.origin) ?? []), w]);
    expect(byBranch.size).toBe(data.skeleton.branches.length - 1);
    for (const vertices of byBranch.values()) {
      const base = vertices.filter((w) => w.along === 0);
      const tip = vertices.filter((w) => w.along === 1);
      expect(Math.max(...tip.map((w) => w.branch))).toBeGreaterThan(Math.max(...base.map((w) => w.branch)));
      // First-level branches start at the stiff trunk; deeper ones ride on their swaying parent.
      for (const w of base) {
        if (w.level === 1) expect(w.branch).toBeCloseTo(0, 5);
        else expect(w.branch).toBeGreaterThan(0);
      }
    }
  });

  it('twigs sway more than the branches they grow on', () => {
    const tips = weights(data.wood).filter((w) => w.along === 1 && w.level > 0);
    const meanAt = (level: number) => {
      const ws = tips.filter((w) => w.level === level).map((w) => w.branch);
      return ws.reduce((a, b) => a + b, 0) / ws.length;
    };
    expect(meanAt(2)).toBeGreaterThan(meanAt(1));
    expect(meanAt(3)).toBeGreaterThan(meanAt(2));
  });

  it('only leaves flutter: 0 on wood, 0 at a leaf base, most at the leaf tip', () => {
    for (const w of weights(data.wood)) expect(w.leaf).toBe(0);
    const leaves = weights(data.leaves);
    for (const w of leaves.filter((w) => w.along === 0)) expect(w.leaf).toBe(0);
    for (const w of leaves.filter((w) => w.along === 1)) expect(w.leaf).toBe(1);
    // Leaves move with the twig they hang on.
    for (const w of leaves) expect(w.branch).toBeGreaterThan(0);
  });

  it('leaves on a bare trunk only follow the trunk sway', () => {
    const bare = generateTree(parseDefinition({ schemaVersion: 2, branches: [], leaves: { count: 5 } }), 1);
    for (const w of weights(bare.leaves)) expect(w.branch).toBe(0);
  });

  for (const shape of ['clump', 'needle'] as const) {
    it(`solid '${shape}' leaves flutter too: weights within 0..1, growing from base to tip, riding their twig`, () => {
      const solid = generateTree(parseDefinition({ ...def, leaves: { ...def.leaves, shape } }), 3);
      const leaves = weights(solid.leaves);
      expect(solid.leaves.attributes.aWind.array.length).toBe(solid.leaves.positions.length);
      for (const w of leaves) {
        expect(w.leaf).toBeCloseTo(w.along, 6);
        expect(w.branch).toBeGreaterThan(0);
        expect(w.trunk).toBeGreaterThanOrEqual(0);
        expect(w.trunk).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...leaves.map((w) => w.leaf))).toBeGreaterThan(0.9);
      expect(Math.min(...leaves.map((w) => w.leaf))).toBeLessThan(0.1);
    });
  }
});
