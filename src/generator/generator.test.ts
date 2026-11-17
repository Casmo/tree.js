import { describe, expect, it } from 'vitest';
import { parseDefinition } from '../definition';
import { generateTree, hashTreeData } from './index';

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
  });

  it('grows the trunk up from the origin to about its Definition length', () => {
    const tall = parseDefinition({ schemaVersion: 1, trunk: { length: 10, lengthVariation: 0.1 } });
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
    expect(skeleton.branches.map((b) => b.path)).toEqual(['0']);
    expect(skeleton.branches[0]!.parent).toBeNull();
  });

  it('matches the golden geometry hash for the default Definition (determinism across releases)', () => {
    expect(hashTreeData(generateTree(def, 42))).toMatchSnapshot();
  });
});
