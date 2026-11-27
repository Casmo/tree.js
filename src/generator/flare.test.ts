import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, TreeDefinitionError } from '../definition';
import { withoutTipBranches } from '../../test/definitions';
import { generateTree, hashGeometry, hashTreeData, type GeometryBuffers, type TreeData, type Vec3 } from './index';

const base = parseDefinition({
  schemaVersion: 3,
  trunk: { stems: 2, spread: 15 },
  branches: [{ count: 5 }, { count: 3, start: 0.2 }],
  leaves: { count: 3 },
  fruit: { type: 'round', count: 1 },
});

const grow = (flare: number | undefined, seed = 7, definition = base) =>
  generateTree(flare === undefined ? definition : extendDefinition(definition, { trunk: { flare } }), seed);
const ringSize = base.trunk.sides + 1;
const stemsOf = (data: TreeData) => data.skeleton.branches.filter((b) => b.parent === null);

/** First wood vertex of each Stem's sweep without flare (Stems come first in the wood buffer). */
function stemOffsets(data: TreeData): number[] {
  let v = 0;
  return stemsOf(data).map((stem) => {
    const first = v;
    v += stem.points.length * ringSize + 1; // rings + tip cap
    return first;
  });
}

const y = (g: GeometryBuffers, v: number) => g.positions[v * 3 + 1]!;

/** Pre-change hashes (before Root Flare existed), seeds 7 and 42: the base ring stood on y = 0. */
/** Wood vertices of a Stem's sweep: its rings and tip cap, all on level 0 with the Stem's base as origin. */
function vertexCount(data: TreeData, path: string): number {
  const [ox, oy, oz] = data.skeleton.branches.find((b) => b.path === path)!.points[0]!.position.map(Math.fround);
  const { aOrigin, aLevel } = data.wood.attributes;
  let count = 0;
  for (let v = 0; v < aLevel.array.length; v++) {
    if (aLevel.array[v] === 0 && aOrigin.array[v * 3] === ox && aOrigin.array[v * 3 + 1] === oy && aOrigin.array[v * 3 + 2] === oz) count++;
  }
  return count;
}

const BASELINE = {
  7: { wood: '39d15aa0', leaves: '1b030d51', fruit: '6719d83f' },
  42: { wood: 'bf0631d6', leaves: 'e2ee939d', fruit: '3e0afcd0' },
} as const;

describe('Root Flare: the sunk base ring', () => {
  it('flare absent and flare 0 give identical trees', () => {
    expect(grow(0).wood).toEqual(grow(undefined).wood);
    expect(hashTreeData(grow(0))).toBe(hashTreeData(grow(undefined)));
  });

  it('only the bottom ring of each Stem changed since before the flare: it sinks 0.1 × trunk radius below the ground', () => {
    for (const seed of [7, 42] as const) {
      // Without Tip Branches, as before them too.
      const data = grow(undefined, seed, withoutTipBranches(base));
      expect(hashGeometry(data.leaves)).toBe(BASELINE[seed].leaves);
      expect(hashGeometry(data.fruit)).toBe(BASELINE[seed].fruit);
      const wood = structuredClone(data.wood);
      for (const first of stemOffsets(data)) {
        for (let v = first; v < first + ringSize; v++) {
          expect(y(wood, v)).toBeCloseTo(-0.1 * base.trunk.radius, 6);
          wood.positions[v * 3 + 1] = 0; // where it stood before
        }
      }
      expect(hashGeometry(wood)).toBe(BASELINE[seed].wood);
    }
  });

  it('the lowest wood vertices sit below the ground', () => {
    for (const flare of [undefined, 0, 0.5, 1]) {
      const { wood } = grow(flare);
      let lowest = Infinity;
      for (let v = 0; v < wood.positions.length / 3; v++) lowest = Math.min(lowest, y(wood, v));
      expect(lowest).toBeLessThan(0);
    }
  });
});

/** One upright, straight Stem. */
const straight = extendDefinition(base, { trunk: { stems: 1, spread: 0, bend: 0, lengthVariation: 0 } });

/** Horizontal distance of a wood vertex from a point. */
const across = (g: GeometryBuffers, v: number, [x, , z]: Vec3) => Math.hypot(g.positions[v * 3]! - x, g.positions[v * 3 + 2]! - z);

describe('Root Flare: the trunk widens into the ground', () => {
  it('widens each Stem\'s base ring to about (1 + 0.8 × flare) × the trunk radius', () => {
    for (const flare of [0.25, 1]) {
      const data = grow(flare);
      let first = 0;
      for (const stem of stemsOf(data)) {
        const centre = stem.points[0]!.position;
        for (let v = first; v < first + ringSize; v++) {
          expect(across(data.wood, v, centre)).toBeCloseTo((1 + 0.8 * flare) * base.trunk.radius, 5);
          expect(y(data.wood, v)).toBeCloseTo(-0.1 * base.trunk.radius, 6);
        }
        first += vertexCount(data, stem.path);
      }
    }
  });

  it('adds 3 extra rings to every Stem (flareSections sets how many), none without flare', () => {
    const rings = (data: TreeData) => stemsOf(data).map((stem) => (vertexCount(data, stem.path) - 1) / ringSize - stem.points.length);
    expect(rings(grow(0))).toEqual([0, 0]);
    expect(rings(grow(0.5))).toEqual([3, 3]);
    expect(rings(grow(0.5, 7, extendDefinition(base, { trunk: { flareSections: 2 } })))).toEqual([2, 2]);
  });

  it('the radius eases out smoothly over the bottom ~12% of the Stem: never narrower than the trunk, widest at the base', () => {
    const data = grow(1, 7, straight);
    const stem = stemsOf(data)[0]!;
    const height = stem.points.at(-1)!.position[1];
    const { aGrowth } = data.wood.attributes;
    const profile: [number, number][] = [];
    for (let v = 0; v < vertexCount(data, '0') - 1; v += ringSize) profile.push([Math.max(y(data.wood, v), 0), aGrowth.array[v * 3 + 2]!]);
    const plain = (h: number) => base.trunk.radius * (1 + (base.trunk.taper - 1) * (h / height));
    for (const [h, radius] of profile) {
      // aGrowth.z carries the flared radius.
      if (h > 0.12 * height + 1e-6) expect(radius).toBeCloseTo(plain(h), 5);
      else expect(radius).toBeGreaterThanOrEqual(plain(h) - 1e-6);
    }
    const flared = profile.filter(([h]) => h < 0.12 * height - 1e-6);
    expect(flared.length).toBeGreaterThanOrEqual(3); // the base and the extra rings below the top of the zone
    for (let i = 1; i < flared.length; i++) expect(flared[i]![1]).toBeLessThan(flared[i - 1]![1]);
  });

  it('never moves a branch, leaf or Fruit: the skeleton, leaves and Fruit are byte-identical for any flare', () => {
    const plain = grow(undefined);
    for (const flare of [0, 0.3, 1]) {
      const data = grow(flare);
      expect(data.skeleton).toEqual(plain.skeleton);
      expect(data.growth).toEqual(plain.growth);
      expect(hashGeometry(data.leaves)).toBe(hashGeometry(plain.leaves));
      expect(hashGeometry(data.fruit)).toBe(hashGeometry(plain.fruit));
    }
  });

  it('the branches\' wood is unchanged; only the Stems\' sweeps differ', () => {
    const plain = grow(0);
    const data = grow(1);
    const tail = (d: TreeData) => {
      const skip = stemsOf(d).reduce((n, stem) => n + vertexCount(d, stem.path), 0);
      return Array.from(d.wood.positions.slice(skip * 3));
    };
    expect(tail(data)).toEqual(tail(plain));
  });

  it('normals in the flare follow the flared surface: they tilt up where the trunk widens', () => {
    const data = grow(1, 7, straight);
    const normalY = (v: number) => data.wood.normals[v * 3 + 1]!;
    const plain = grow(0, 7, straight);
    expect(normalY(0)).toBeGreaterThan(plain.wood.normals[1]! + 0.2);
    for (let v = 0; v < data.wood.normals.length / 3; v++) {
      expect(Math.hypot(data.wood.normals[v * 3]!, normalY(v), data.wood.normals[v * 3 + 2]!)).toBeCloseTo(1, 4);
    }
  });
});

describe('Root Flare: the Definition', () => {
  it('accepts trunk.flare in 0..1, rejects values outside it; absent by default', () => {
    expect(base.trunk).not.toHaveProperty('flare');
    for (const flare of [0, 0.5, 1]) expect(extendDefinition(base, { trunk: { flare } }).trunk.flare).toBe(flare);
    for (const flare of [-0.1, 1.1]) {
      expect(() => parseDefinition({ schemaVersion: 3, trunk: { flare } })).toThrow(TreeDefinitionError);
    }
  });
});
