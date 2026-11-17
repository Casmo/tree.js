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
    const { geometry } = generateTree(def, 5);
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
    const { geometry } = generateTree(tall, 3);
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
