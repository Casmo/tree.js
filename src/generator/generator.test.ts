import { describe, expect, it } from 'vitest';
import { parseDefinition } from '../definition';
import { generateTree, hashTreeData, type GeometryBuffers, type SkeletonBranch } from './index';

const def = parseDefinition({ schemaVersion: 1 });

describe('generateTree', () => {
  it('gives an identical geometry hash for the same Definition and Seed', () => {
    expect(hashTreeData(generateTree(def, 1))).toBe(hashTreeData(generateTree(def, 1)));
  });

  it('gives a different geometry hash for a different Seed', () => {
    expect(hashTreeData(generateTree(def, 1))).not.toBe(hashTreeData(generateTree(def, 2)));
  });

  it('builds a closed-index, well-formed trunk mesh', () => {
    const { wood: geometry } = generateTree(def, 5);
    const vertexCount = geometry.positions.length / 3;
    expect(geometry.normals.length).toBe(geometry.positions.length);
    expect(geometry.uvs.length).toBe(vertexCount * 2);
    expect(geometry.indices.length % 3).toBe(0);
    expect(geometry.indices.length).toBeGreaterThan(0);
    for (const i of geometry.indices) expect(i).toBeLessThan(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
      const [x, y, z] = [geometry.normals[v * 3]!, geometry.normals[v * 3 + 1]!, geometry.normals[v * 3 + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
    }
    expectFrontFacesAlongNormals(geometry);
  });

  it('grows the trunk up from the origin to about its Definition length', () => {
    const tall = parseDefinition({ schemaVersion: 1, trunk: { length: 10, lengthVariation: 0.1 }, branches: [] });
    const { wood: geometry } = generateTree(tall, 3);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < geometry.positions.length; i += 3) {
      minY = Math.min(minY, geometry.positions[i]!);
      maxY = Math.max(maxY, geometry.positions[i]!);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeGreaterThan(10 * 0.85);
    expect(maxY).toBeLessThan(10 * 1.15);
  });

  it('exposes the trunk as the root branch of the skeleton with path "0"', () => {
    const { skeleton } = generateTree(def, 1);
    expect(skeleton.branches[0]!.path).toBe('0');
    expect(skeleton.branches[0]!.parent).toBeNull();
    expect(skeleton.branches[0]!.level).toBe(0);
  });

  it('a Definition without branch levels grows only a trunk', () => {
    const bare = parseDefinition({ schemaVersion: 1, branches: [] });
    expect(generateTree(bare, 1).skeleton.branches.map((b) => b.path)).toEqual(['0']);
  });

  it('matches the golden geometry hash for the default Definition (determinism across releases)', () => {
    expect(hashTreeData(generateTree(def, 42))).toMatchSnapshot();
  });
});

/** Counter-clockwise triangles (three.js front faces) must face the way their vertex normals point. */
function expectFrontFacesAlongNormals(g: GeometryBuffers): void {
  const p = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!];
  let agree = 0;
  const triangles = g.indices.length / 3;
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [g.indices[t * 3]!, g.indices[t * 3 + 1]!, g.indices[t * 3 + 2]!];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
    const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
    const face = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const n = [0, 1, 2].map((k) => g.normals[a * 3 + k]! + g.normals[b * 3 + k]! + g.normals[c * 3 + k]!);
    if (face[0]! * n[0]! + face[1]! * n[1]! + face[2]! * n[2]! > 0) agree++;
  }
  expect(agree).toBe(triangles);
}

function pathLength(branch: SkeletonBranch): number {
  let length = 0;
  for (let i = 1; i < branch.points.length; i++) {
    const [a, b] = [branch.points[i - 1]!.position, branch.points[i]!.position];
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
}

describe('branching skeleton', () => {
  const three = parseDefinition({
    schemaVersion: 1,
    branches: [
      { count: 6, countVariation: 0.5 },
      { count: 4, countVariation: 0 },
      { count: 2, countVariation: 0.5 },
    ],
  });

  it('grows every branching level, each branch addressed as <parent path>.<index>', () => {
    const { skeleton } = generateTree(three, 7);
    const byPath = new Map(skeleton.branches.map((b) => [b.path, b]));
    expect(new Set(skeleton.branches.map((b) => b.level))).toEqual(new Set([0, 1, 2, 3]));
    for (const branch of skeleton.branches.slice(1)) {
      const parent = byPath.get(branch.parent!);
      expect(parent).toBeDefined();
      expect(branch.level).toBe(parent!.level + 1);
      expect(branch.path).toMatch(new RegExp(`^${branch.parent!.replace(/\./g, '\\.')}\\.\\d+$`));
    }
    // Siblings are numbered 0..n-1 without gaps.
    for (const parent of skeleton.branches) {
      const indices = skeleton.branches
        .filter((b) => b.parent === parent.path)
        .map((b) => Number(b.path.split('.').at(-1)));
      expect(indices).toEqual(indices.map((_, i) => i));
    }
  });

  it('gives the same branch paths and points for the same Definition and Seed', () => {
    expect(generateTree(three, 3).skeleton).toEqual(generateTree(three, 3).skeleton);
  });

  it('keeps existing branches in place when a deeper level or the leaves change (Sculpt stability)', () => {
    const changed = parseDefinition({
      schemaVersion: 1,
      branches: [three.branches[0], three.branches[1], { count: 5 }],
      leaves: { count: 2, size: 1 },
    });
    const outer = (d: typeof three) =>
      generateTree(d, 9).skeleton.branches.filter((b) => b.level <= 2);
    expect(outer(changed)).toEqual(outer(three));
  });

  it('keeps Seed variation within the ranges the Definition declares', () => {
    for (let seed = 0; seed < 25; seed++) {
      const { skeleton } = generateTree(three, seed);
      const byPath = new Map(skeleton.branches.map((b) => [b.path, b]));
      for (const parent of skeleton.branches) {
        const level = three.branches[parent.level];
        if (!level) continue;
        const children = skeleton.branches.filter((b) => b.parent === parent.path);
        expect(children.length).toBeGreaterThanOrEqual(Math.round(level.count * (1 - level.countVariation)));
        expect(children.length).toBeLessThanOrEqual(Math.round(level.count * (1 + level.countVariation)));
        for (const child of children) {
          const ratio = pathLength(child) / pathLength(byPath.get(child.parent!)!);
          expect(ratio).toBeGreaterThanOrEqual(level.length * (1 - level.lengthVariation) - 1e-9);
          expect(ratio).toBeLessThanOrEqual(level.length * (1 + level.lengthVariation) + 1e-9);
          expect(child.points[0]!.radius).toBeLessThanOrEqual(parent.points[0]!.radius * level.radius + 1e-9);
          expect(child.points.length).toBe(level.sections + 1);
        }
      }
    }
  });
});

describe('leaves', () => {
  const leafy = parseDefinition({
    schemaVersion: 1,
    branches: [{ count: 4 }, { count: 3 }],
    leaves: { count: 6, size: 0.4, sizeVariation: 0.3, color: '#408020', colorVariation: 0.2 },
  });
  const srgb = [0x40 / 255, 0x80 / 255, 0x20 / 255];

  it('puts the declared number of leaves on every outermost branch, each with a stable id', () => {
    const { skeleton } = generateTree(leafy, 4);
    const outermost = skeleton.branches.filter((b) => b.level === 2);
    expect(outermost.length).toBeGreaterThan(0);
    expect(skeleton.leaves).toHaveLength(outermost.length * 6);
    for (const branch of outermost) {
      const ids = skeleton.leaves.filter((l) => l.branch === branch.path).map((l) => l.id);
      expect(ids).toEqual([0, 1, 2, 3, 4, 5].map((i) => `${branch.path}/${i}`));
    }
  });

  it('grows leaves on the trunk when there are no branch levels, and none when count is 0', () => {
    const trunkOnly = parseDefinition({ schemaVersion: 1, branches: [], leaves: { count: 3 } });
    expect(generateTree(trunkOnly, 1).skeleton.leaves.map((l) => l.branch)).toEqual(['0', '0', '0']);
    const bare = parseDefinition({ schemaVersion: 1, leaves: { count: 0 } });
    const data = generateTree(bare, 1);
    expect(data.skeleton.leaves).toEqual([]);
    expect(data.leaves.indices.length).toBe(0);
  });

  it('keeps leaf size and colour within the ranges the Definition declares', () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const leaf of generateTree(leafy, seed).skeleton.leaves) {
        expect(leaf.size).toBeGreaterThanOrEqual(0.4 * 0.7 - 1e-9);
        expect(leaf.size).toBeLessThanOrEqual(0.4 * 1.3 + 1e-9);
        leaf.color.forEach((c, k) => {
          expect(c).toBeGreaterThanOrEqual(srgb[k]! * 0.8 - 1e-9);
          expect(c).toBeLessThanOrEqual(Math.min(1, srgb[k]! * 1.2) + 1e-9);
        });
      }
    }
  });

  it('varies leaf colours with the Seed', () => {
    const colour = (seed: number) => generateTree(leafy, seed).skeleton.leaves[0]!.color;
    expect(colour(1)).not.toEqual(colour(2));
  });

  it('builds a well-formed, vertex-coloured leaf mesh', () => {
    const { leaves, skeleton } = generateTree(leafy, 2);
    const vertexCount = leaves.positions.length / 3;
    expect(vertexCount).toBeGreaterThanOrEqual(skeleton.leaves.length * 3);
    expect(leaves.normals.length).toBe(leaves.positions.length);
    expect(leaves.uvs.length).toBe(vertexCount * 2);
    expect(leaves.colors!.length).toBe(vertexCount * 3);
    for (const c of leaves.colors!) expect(c).toBeGreaterThanOrEqual(0);
    for (const c of leaves.colors!) expect(c).toBeLessThanOrEqual(1);
    for (const i of leaves.indices) expect(i).toBeLessThan(vertexCount);
    expectFrontFacesAlongNormals(leaves);
  });

  it('attaches each leaf to its branch', () => {
    const { skeleton } = generateTree(leafy, 6);
    const byPath = new Map(skeleton.branches.map((b) => [b.path, b]));
    for (const leaf of skeleton.leaves) {
      const branch = byPath.get(leaf.branch)!;
      const nearest = Math.min(
        ...branch.points.map((p) =>
          Math.hypot(p.position[0] - leaf.position[0], p.position[1] - leaf.position[1], p.position[2] - leaf.position[2]),
        ),
      );
      expect(nearest).toBeLessThanOrEqual(pathLength(branch) / (branch.points.length - 1) + 1e-6);
    }
  });
});

describe('per-vertex attributes', () => {
  const levels = def.branches.length;
  const data = generateTree(def, 8);

  for (const [mesh, buffers] of [
    ['wood', data.wood],
    ['leaves', data.leaves],
  ] as const) {
    it(`${mesh}: every attribute has one value per vertex, within range`, () => {
      const vertexCount = buffers.positions.length / 3;
      const { aLevel, aAlong, aAttach, aRandom, aOrigin } = buffers.attributes;
      for (const a of [aLevel, aAlong, aAttach, aRandom]) {
        expect(a.itemSize).toBe(1);
        expect(a.array.length).toBe(vertexCount);
      }
      expect(aOrigin.itemSize).toBe(3);
      expect(aOrigin.array.length).toBe(vertexCount * 3);
      for (const a of [aAlong, aAttach, aRandom]) {
        for (const x of a.array) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
        }
      }
      for (const x of aLevel.array) {
        expect(Number.isInteger(x)).toBe(true);
        if (mesh === 'leaves') expect(x).toBe(levels + 1);
        else expect(x).toBeLessThanOrEqual(levels);
      }
    });
  }

  it('wood: each branch is pinned to its own base point, the trunk at the origin', () => {
    const { aOrigin, aLevel } = data.wood.attributes;
    const bases = new Set(data.skeleton.branches.map((b) => b.points[0]!.position.map((x) => Math.fround(x)).join()));
    const origins = new Set<string>();
    for (let v = 0; v < aLevel.array.length; v++) {
      const o = [...aOrigin.array.subarray(v * 3, v * 3 + 3)];
      origins.add(o.join());
      if (aLevel.array[v] === 0) expect(o).toEqual([0, 0, 0]);
    }
    expect(origins).toEqual(bases);
  });

  it('changing an attribute changes the hash', () => {
    const copy = generateTree(def, 8);
    copy.wood.attributes.aRandom.array[0] = 0.123;
    expect(hashTreeData(copy)).not.toBe(hashTreeData(data));
  });
});
