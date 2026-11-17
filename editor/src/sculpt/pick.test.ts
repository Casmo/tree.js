import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three/webgpu';
import { createTree, parseDefinition, type TreeDefinition } from '@casmo/tree.js';
import { brushBranches, dragTurn, nearestBranch } from './pick';

/** The generated data of a tree (public API: what `createTree` grows). */
const treeData = (definition: TreeDefinition, seed: number) => createTree(definition, { seed }).data;

const def = parseDefinition({ schemaVersion: 2 });
const { branches } = treeData(def, 3).skeleton;

describe('picking parts of the tree', () => {
  it('a point on the bark of a branch picks that branch', () => {
    for (const path of ['0', '0.2', '0.3.1']) {
      const branch = branches.find((b) => b.path === path)!;
      const [a, b] = [branch.points[1]!, branch.points[2]!];
      const mid = new Vector3(...a.position).lerp(new Vector3(...b.position), 0.5);
      const along = new Vector3(...b.position).sub(new Vector3(...a.position)).normalize();
      const side = new Vector3(0, 0, 1).cross(along).normalize().multiplyScalar(a.radius * 0.9);
      expect(nearestBranch(branches, mid.add(side).toArray())).toBe(path);
    }
  });

  it('the leaf brush reaches the leaf-bearing branches near the point', () => {
    const twig = branches.find((b) => b.level === def.branches.length)!;
    const tip = twig.points.at(-1)!.position;
    expect(brushBranches(branches, def.branches.length, tip, 0.01)).toEqual([twig.path]);
    const wide = brushBranches(branches, def.branches.length, tip, 100);
    expect(wide.length).toBe(branches.filter((b) => b.level === def.branches.length).length);
    expect(brushBranches(branches, def.branches.length, [100, 100, 100], 1)).toEqual([]);
  });

  it('dragging a point of a branch turns the branch about its base (Shift: also stretches)', () => {
    const turn = dragTurn([1, 1, 1], [2, 1, 1], [1, 3, 1], false);
    const q = new Quaternion(...turn.rotation);
    expect(new Vector3(1, 0, 0).applyQuaternion(q).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9);
    expect(turn.scale).toBe(1);
    expect(dragTurn([1, 1, 1], [2, 1, 1], [1, 3, 1], true).scale).toBeCloseTo(2);
  });
});
