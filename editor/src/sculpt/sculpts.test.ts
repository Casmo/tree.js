import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import { generateTree, hashTreeData, parseDefinition, type SkeletonBranch, type TreeDefinition } from '@casmo/tree.js';
import { clearSculpts, deleteBranch, moveBranch, paintLeaves, removeSculpt } from './sculpts';

const def = parseDefinition({ schemaVersion: 2 });
const paths = (definition: typeof def, seed: number) => generateTree(definition, seed).skeleton.branches.map((b) => b.path);

describe('Sculpt edits', () => {
  it('deleting a branch removes it and everything on it, on the current Seed only', () => {
    const edited = deleteBranch(def, 3, '0.1');
    expect(paths(edited, 3)).not.toContain('0.1');
    expect(paths(edited, 3).some((p) => p.startsWith('0.1.'))).toBe(false);
    expect(paths(edited, 3)).toContain('0.2');
    expect(hashTreeData(generateTree(edited, 4))).toBe(hashTreeData(generateTree(def, 4)));
  });

  it('each move turns (and stretches) the branch as it looks now, with everything on it', () => {
    const seed = 3;
    const turns: [string, Euler, number][] = [
      ['0.2.0', new Euler(0.4, 0, 0.2), 1],
      ['0.2', new Euler(0, 0.9, -0.5), 1.3],
      ['0.2.0', new Euler(-0.2, 0.3, 0), 0.8],
      ['0.2', new Euler(0.1, 0, 0.6), 1],
      ['0.2', new Euler(0, -0.4, 0), 1.1],
    ];
    let definition: TreeDefinition = def;
    for (const [path, euler, scale] of turns) {
      const before = generateTree(definition, seed).skeleton.branches;
      const rotation = new Quaternion().setFromEuler(euler);
      definition = moveBranch(definition, seed, path, { rotation: rotation.toArray() as [number, number, number, number], scale });
      const after = new Map(generateTree(definition, seed).skeleton.branches.map((b) => [b.path, b]));
      const base = new Vector3(...before.find((b) => b.path === path)!.points[0]!.position);
      const expected = (p: SkeletonBranch['points'][number]['position']) =>
        new Vector3(...p).sub(base).multiplyScalar(scale).applyQuaternion(rotation).add(base);
      for (const branch of before) {
        const moved = branch.path === path || branch.path.startsWith(`${path}.`);
        branch.points.forEach((point, i) => {
          const want = moved ? expected(point.position) : new Vector3(...point.position);
          expect(new Vector3(...after.get(branch.path)!.points[i]!.position).distanceTo(want)).toBeLessThan(1e-6);
        });
      }
    }
    // Repeated moves of the same branch stay one Sculpt where that gives the same tree.
    expect(definition.sculpts.length).toBeLessThan(turns.length);
  });

  it('painting sets the leaf coverage of branches; painting full coverage back restores the tree', () => {
    const seed = 3;
    const leafy = generateTree(def, seed).skeleton.leaves;
    const branches = [...new Set(leafy.map((l) => l.branch))].slice(0, 6);
    const on = (definition: TreeDefinition) =>
      generateTree(definition, seed).skeleton.leaves.filter((l) => branches.includes(l.branch)).length;
    const before = on(def);

    const bare = paintLeaves(def, seed, branches, 0);
    expect(on(bare)).toBe(0);
    expect(generateTree(bare, seed).skeleton.leaves.length).toBe(leafy.length - before);
    const half = paintLeaves(bare, seed, branches, 0.5);
    expect(on(half)).toBeGreaterThan(0);
    expect(on(half)).toBeLessThan(before);
    expect(half.sculpts).toHaveLength(branches.length); // repainting replaces, it does not pile up

    const restored = paintLeaves(half, seed, branches, 1);
    expect(restored.sculpts).toEqual([]);
    expect(hashTreeData(generateTree(restored, seed))).toBe(hashTreeData(generateTree(def, seed)));
  });

  it('removes one Sculpt, or clears those of one Seed only', () => {
    const edited = deleteBranch(deleteBranch(deleteBranch(def, 3, '0.1'), 4, '0.2'), 3, '0.3');
    expect(removeSculpt(edited, 1).sculpts.map((s) => s.path)).toEqual(['0.1', '0.3']);
    expect(clearSculpts(edited, 3).sculpts).toEqual([{ seed: 4, path: '0.2', action: 'delete' }]);
  });
});
