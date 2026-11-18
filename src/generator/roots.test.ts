import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOTS, extendDefinition, type DefinitionPatch, parseDefinition, TreeDefinitionError } from '../definition';
import { generateTree, hashGeometry, hashTreeData, type GeometryBuffers, type TreeData } from './index';

const plain = parseDefinition({
  schemaVersion: 3,
  trunk: { flare: 0.5 },
  branches: [{ count: 5 }, { count: 3, start: 0.2 }],
  leaves: { count: 3 },
  fruit: { type: 'round', count: 1 },
});
const rooted = extendDefinition(plain, { roots: { count: 5 } });

/** The first vertices and triangles of `wood`, as many as `like` has. */
function prefix(wood: GeometryBuffers, like: GeometryBuffers): GeometryBuffers {
  const vertices = like.positions.length / 3;
  return {
    positions: wood.positions.slice(0, vertices * 3),
    normals: wood.normals.slice(0, vertices * 3),
    uvs: wood.uvs.slice(0, vertices * 2),
    indices: wood.indices.slice(0, like.indices.length),
    attributes: Object.fromEntries(
      Object.entries(wood.attributes).map(([name, a]) => [name, { array: a.array.slice(0, vertices * a.itemSize), itemSize: a.itemSize }]),
    ) as GeometryBuffers['attributes'],
  };
}

const stemsOf = (data: TreeData) => data.skeleton.branches.filter((b) => b.parent === null);

describe('Roots on a single Stem', () => {
  it('grows `count` Roots from the Stem, paths 0/r0, 0/r1, ..., each tapering to a point below the ground', () => {
    const { skeleton } = generateTree(rooted, 7);
    expect(skeleton.roots.map((r) => r.path)).toEqual(['0/r0', '0/r1', '0/r2', '0/r3', '0/r4']);
    for (const root of skeleton.roots) {
      expect(root.parent).toBe('0');
      const tip = root.points.at(-1)!;
      expect(tip.position[1]).toBeLessThan(0);
      expect(tip.radius).toBe(0);
    }
  });

  it('leaves, Fruit, the skeleton and Growth of every other part, and the wood before the Roots are byte-identical with or without Roots', () => {
    for (const seed of [7, 42]) {
      const without = generateTree(plain, seed);
      const withRoots = generateTree(rooted, seed);
      expect(without.skeleton.roots).toEqual([]);
      expect(without.growth.roots).toEqual([]);
      expect(withRoots.skeleton.branches).toEqual(without.skeleton.branches);
      expect(withRoots.skeleton.leaves).toEqual(without.skeleton.leaves);
      expect(withRoots.skeleton.fruit).toEqual(without.skeleton.fruit);
      expect(withRoots.growth.branches).toEqual(without.growth.branches);
      expect(hashGeometry(withRoots.leaves)).toBe(hashGeometry(without.leaves));
      expect(hashGeometry(withRoots.fruit)).toBe(hashGeometry(without.fruit));
      expect(hashGeometry(prefix(withRoots.wood, without.wood))).toBe(hashGeometry(without.wood));
      // The tree hash covers the Roots.
      expect(withRoots.wood.positions.length).toBeGreaterThan(without.wood.positions.length);
      expect(hashTreeData(withRoots)).not.toBe(hashTreeData(without));
    }
  });

  it('Roots never sway in the Wind (no branch sway, no flutter) and grow like the trunk, from Growth 0 with the whole tree', () => {
    const without = generateTree(plain, 7);
    const data = generateTree(rooted, 7);
    expect(data.growth.roots).toEqual(data.skeleton.roots.map(() => data.growth.branches[0]));
    const { aWind, aGrowth, aLevel } = data.wood.attributes;
    const first = without.wood.positions.length / 3;
    const count = data.wood.positions.length / 3;
    for (let v = first; v < count; v++) {
      expect(aWind.array[v * 3 + 1]).toBe(0);
      expect(aWind.array[v * 3 + 2]).toBe(0);
      expect(aWind.array[v * 3]).toBeLessThan(0.01); // trunk sway from height, as for all wood: about 0 near the ground
      expect([aGrowth.array[v * 3], aGrowth.array[v * 3 + 1]]).toEqual([0, 0]);
      expect(aLevel.array[v]).toBe(0);
    }
  });

  it('start on the Root Flare slightly above the ground, run outward and down, spread evenly all round the Stem', () => {
    const data = generateTree(extendDefinition(rooted, { roots: { count: 6, bend: 0 } }), 7);
    const stem = stemsOf(data)[0]!;
    const [cx, , cz] = stem.points[0]!.position;
    const radius = stem.points[0]!.radius;
    const azimuths = data.skeleton.roots.map((root) => {
      const start = root.points[0]!.position;
      const tip = root.points.at(-1)!.position;
      expect(start[1]).toBeGreaterThan(0);
      expect(start[1]).toBeLessThan(radius);
      expect(Math.hypot(start[0] - cx, start[2] - cz)).toBeLessThan(radius);
      expect(Math.hypot(tip[0] - cx, tip[2] - cz)).toBeGreaterThan(Math.hypot(start[0] - cx, start[2] - cz) + radius);
      const ys = root.points.map((p) => p.position[1]);
      for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]!);
      const radii = root.points.map((p) => p.radius);
      expect(radii[0]).toBeCloseTo(0.35 * radius, 6);
      for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]!);
      return Math.atan2(tip[2] - cz, tip[0] - cx);
    });
    // Evenly spaced with Seed jitter: every gap between neighbours is within ±50 % of 60°.
    const sorted = azimuths.map((a) => (a + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
    const gaps = sorted.map((a, i) => ((sorted[(i + 1) % sorted.length]! - a + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI));
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(30);
      expect(gap).toBeLessThan(90);
    }
  });

  it('length is a fraction of the Stem\'s length, within the Seed\'s lengthVariation; angle sets how steeply they dive', () => {
    const exact = extendDefinition(rooted, { roots: { lengthVariation: 0, bend: 0, angle: 30, length: 0.2 } });
    const data = generateTree(exact, 7);
    const stem = stemsOf(data)[0]!;
    const stemLength = stem.points.slice(1).reduce((n, p, i) => n + Math.hypot(...(p.position.map((x, k) => x - stem.points[i]!.position[k]!) as [number, number, number])), 0);
    for (const root of data.skeleton.roots) {
      const [a, b] = [root.points[0]!.position, root.points[1]!.position];
      const dive = Math.atan2(a[1] - b[1], Math.hypot(b[0] - a[0], b[2] - a[2])) * (180 / Math.PI);
      expect(dive).toBeCloseTo(30, 3);
      const run = root.points.slice(1).reduce((n, p, i) => n + Math.hypot(...(p.position.map((x, k) => x - root.points[i]!.position[k]!) as [number, number, number])), 0);
      expect(run).toBeCloseTo(0.2 * stemLength, 3);
    }
    const varied = generateTree(extendDefinition(rooted, { roots: { lengthVariation: 0.3, bend: 0, angle: 30, length: 0.2 } }), 7);
    const reach = (root: TreeData['skeleton']['roots'][number]) => Math.hypot(root.points.at(-1)!.position[0] - root.points[0]!.position[0], root.points.at(-1)!.position[2] - root.points[0]!.position[2]);
    const reaches = varied.skeleton.roots.map(reach);
    expect(new Set(reaches.map((r) => r.toFixed(4))).size).toBe(reaches.length);
    for (const r of reaches) {
      expect(r).toBeGreaterThan(0.7 * reach(data.skeleton.roots[0]!) - 1e-6);
      expect(r).toBeLessThan(1.3 * reach(data.skeleton.roots[0]!) + 1e-6);
    }
  });

  it('count 0 grows none; sides and sections set the Roots\' polygon detail', () => {
    expect(generateTree(extendDefinition(rooted, { roots: { count: 0 } }), 7).skeleton.roots).toEqual([]);
    const without = generateTree(plain, 7);
    const vertices = (d: TreeData) => d.wood.positions.length / 3 - without.wood.positions.length / 3;
    const detailed = generateTree(extendDefinition(rooted, { roots: { sides: 3, sections: 2 } }), 7);
    expect(detailed.skeleton.roots.every((root) => root.points.length === 3)).toBe(true);
    expect(vertices(detailed)).toBe(5 * (3 * 4 + 1)); // 3 rings of 3 sides + seam vertex, + tip
    // Absent: 4 sections, about two thirds of the trunk's sides (8 -> 5).
    const plainDetail = generateTree(rooted, 7);
    expect(plainDetail.skeleton.roots.every((root) => root.points.length === 5)).toBe(true);
    expect(vertices(plainDetail)).toBe(5 * (5 * 6 + 1));
  });
});

describe('the roots block of a Tree Definition', () => {
  it('is absent unless given: a Definition without Roots grows none', () => {
    expect(parseDefinition({ schemaVersion: 3 })).not.toHaveProperty('roots');
  });

  it('fills the missing fields of a partial block from DEFAULT_ROOTS; sides and sections stay absent', () => {
    expect(DEFAULT_ROOTS).toEqual({ count: 5, length: 0.25, lengthVariation: 0.3, radius: 0.35, angle: 12, bend: 0.3 });
    expect(parseDefinition({ schemaVersion: 3, roots: { count: 3 } }).roots).toEqual({ ...DEFAULT_ROOTS, count: 3 });
    expect(parseDefinition({ schemaVersion: 3, roots: {} }).roots).toEqual(DEFAULT_ROOTS);
  });

  it('accepts every field at the ends of its range', () => {
    for (const roots of [
      { count: 0, length: 0, lengthVariation: 0, radius: 0, angle: 0, bend: 0, sides: 3, sections: 1 },
      { count: 12, length: 1, lengthVariation: 1, radius: 1, angle: 60, bend: 1, sides: 16, sections: 20 },
    ]) {
      expect(parseDefinition({ schemaVersion: 3, roots }).roots).toEqual(roots);
    }
  });

  it.each([
    ['count', { count: 13 }],
    ['count', { count: -1 }],
    ['count', { count: 2.5 }],
    ['length', { length: 1.2 }],
    ['lengthVariation', { lengthVariation: -0.1 }],
    ['radius', { radius: 1.5 }],
    ['angle', { angle: 61 }],
    ['angle', { angle: -5 }],
    ['bend', { bend: 2 }],
    ['sides', { sides: 2 }],
    ['sides', { sides: 17 }],
    ['sections', { sections: 0 }],
    ['sink', { sink: 0.5 }],
  ])('rejects an out-of-range or unknown roots.%s', (field, roots) => {
    expect(() => parseDefinition({ schemaVersion: 3, roots })).toThrow(TreeDefinitionError);
    expect(() => parseDefinition({ schemaVersion: 3, roots })).toThrow(`roots.${field}`);
  });
});

describe('Roots with several Stems and Sculpts', () => {
  const ring = extendDefinition(rooted, { trunk: { stems: 3, spread: 15 }, roots: { count: 6, bend: 0 } });
  /** Horizontal unit vector from the ring centre (the origin) out to the Stem's base. */
  const outward = (stem: TreeData['skeleton']['branches'][number]) => {
    const [x, , z] = stem.points[0]!.position;
    const d = Math.hypot(x, z);
    return [x / d, z / d] as const;
  };
  /** Horizontal unit vector a Root runs in, from its start to its tip. */
  const heading = (root: TreeData['skeleton']['roots'][number]) => {
    const [a, b] = [root.points[0]!.position, root.points.at(-1)!.position];
    const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    return [(b[0] - a[0]) / d, (b[2] - a[2]) / d] as const;
  };

  it('each Stem\'s Roots cover only the outward-facing half-circle, away from the ring centre', () => {
    for (const seed of [7, 42, 99]) {
      const data = generateTree(ring, seed);
      const stems = stemsOf(data);
      expect(stems.length).toBe(3);
      for (const stem of stems) {
        const roots = data.skeleton.roots.filter((r) => r.parent === stem.path);
        expect(roots.length).toBe(6);
        const [ox, oz] = outward(stem);
        const turns = roots.map((root) => {
          const [hx, hz] = heading(root);
          expect(hx * ox + hz * oz).toBeGreaterThan(0); // never towards the ring centre
          return Math.atan2(hx * oz - hz * ox, hx * ox + hz * oz) * (180 / Math.PI);
        });
        // Spread over the half-circle, not bunched straight out.
        expect(Math.max(...turns) - Math.min(...turns)).toBeGreaterThan(90);
      }
    }
  });

  const sculpt = (sculpts: NonNullable<DefinitionPatch['sculpts']>) => extendDefinition(ring, { sculpts });
  const rootsOf = (data: TreeData, stem: string) => data.skeleton.roots.filter((r) => r.parent === stem);

  it('a deleted Stem has no Roots; the other Stems keep theirs, unchanged', () => {
    const plainTree = generateTree(ring, 7);
    const data = generateTree(sculpt([{ seed: 7, path: '1', action: 'delete' }]), 7);
    expect(rootsOf(data, '1')).toEqual([]);
    expect(data.skeleton.roots.every((r) => data.skeleton.branches.some((b) => b.path === r.parent))).toBe(true);
    expect(data.skeleton.roots).toEqual(plainTree.skeleton.roots.filter((r) => r.parent !== '1'));
  });

  it('a rotated Stem keeps its Roots on the ground at its unchanged base: they never tilt into the air', () => {
    const plainTree = generateTree(ring, 7);
    const data = generateTree(sculpt([{ seed: 7, path: '1', action: 'move', rotation: [0.5, 0, 0.6], scale: 1 }]), 7);
    const stem = stemsOf(data).find((s) => s.path === '1')!;
    expect(stem.points.at(-1)).not.toEqual(stemsOf(plainTree).find((s) => s.path === '1')!.points.at(-1));
    // Exactly where they were before the turn (up to rounding: the turned Stem's length is summed anew).
    const roots = rootsOf(data, '1');
    const before = rootsOf(plainTree, '1');
    expect(roots.map((r) => r.path)).toEqual(before.map((r) => r.path));
    roots.forEach((root, i) =>
      root.points.forEach((p, j) => p.position.forEach((x, k) => expect(x).toBeCloseTo(before[i]!.points[j]!.position[k]!, 9))),
    );
    const [cx, , cz] = stem.points[0]!.position;
    for (const root of roots) {
      const start = root.points[0]!.position;
      expect(start[1]).toBeGreaterThan(0);
      expect(start[1]).toBeLessThan(stem.points[0]!.radius);
      expect(Math.hypot(start[0] - cx, start[2] - cz)).toBeLessThan(stem.points[0]!.radius);
      expect(root.points.at(-1)!.position[1]).toBeLessThan(0);
    }
  });

  it('a scaled Stem\'s Roots scale with its new length (their thickness follows the trunk radius, which stays)', () => {
    const run = (root: TreeData['skeleton']['roots'][number]) =>
      root.points.slice(1).reduce((n, p, i) => n + Math.hypot(...(p.position.map((x, k) => x - root.points[i]!.position[k]!) as [number, number, number])), 0);
    const plainTree = generateTree(extendDefinition(ring, { roots: { angle: 30 } }), 7);
    const data = generateTree(extendDefinition(ring, { roots: { angle: 30 }, sculpts: [{ seed: 7, path: '1', action: 'move', rotation: [0, 0, 0], scale: 1.5 }] }), 7);
    const before = rootsOf(plainTree, '1');
    const after = rootsOf(data, '1');
    expect(after.length).toBe(before.length);
    after.forEach((root, i) => {
      expect(run(root)).toBeCloseTo(1.5 * run(before[i]!), 6);
      expect(root.points[0]!.radius).toBe(before[i]!.points[0]!.radius);
    });
  });

  it('one Stem\'s Sculpts never change another Stem\'s Roots', () => {
    const plainTree = generateTree(ring, 7);
    for (const sculpts of [
      [{ seed: 7, path: '1', action: 'move' as const, rotation: [0.3, 0.2, -0.4] as [number, number, number], scale: 0.7 }],
      [{ seed: 7, path: '1', action: 'delete' as const }],
      [{ seed: 7, path: '1.2', action: 'delete' as const }],
    ]) {
      const data = generateTree(sculpt(sculpts), 7);
      for (const other of ['0', '2']) expect(rootsOf(data, other)).toEqual(rootsOf(plainTree, other));
    }
  });
});
