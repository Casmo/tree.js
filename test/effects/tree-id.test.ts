import { describe, expect, it } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createForest, createTree, type ForestPlacement, type TreeDefinitionInput } from '../../src/index';
import { mrt, output, pass } from 'three/tsl';
import { NearestFilter, PerspectiveCamera, RedIntegerFormat, Scene, UnsignedIntType } from 'three/webgpu';
import { TREE_ID, TREE_MASK, treeEffectsPass, treeFromId, treeIdMRT, treeIdOf, treeIdTexture, treeMaskMRT } from '../../src/effects';

// A small tree keeps generation fast.
const definition: TreeDefinitionInput = { schemaVersion: 2, branches: [{ count: 3 }], leaves: { count: 2 } };

function grid(n: number): ForestPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ position: [(i % 10) * 3, 0, Math.floor(i / 10) * 3] as [number, number, number] }));
}

describe('Tree ID', () => {
  it('gives a Tree a nonzero ID that resolves back to it', () => {
    const tree = createTree(definition, { seed: 1 });
    const id = treeIdOf(tree);
    expect(id).toBeGreaterThan(0);
    expect(treeIdOf(tree)).toBe(id);
    expect(treeFromId(id!)).toBe(tree);
  });

  it('gives every Tree and every Forest tree its own ID, resolving back to that tree', () => {
    const trees = [createTree(definition, { seed: 1 }), createTree(definition, { seed: 2 })];
    const forest = createForest(definition, grid(30), { variants: 3 });
    const all = [...trees, ...forest.trees];
    const ids = all.map((t) => treeIdOf(t)!);
    expect(new Set(ids).size).toBe(all.length);
    for (const [i, tree] of all.entries()) {
      expect(ids[i]).toBeGreaterThan(0);
      expect(treeFromId(ids[i]!)).toBe(tree);
    }
  });

  it('resolves every remaining tree after a swap-remove, and a removed tree to undefined', () => {
    const forest = createForest(definition, grid(12), { variants: 1 });
    const [first, second] = forest.trees;
    const firstId = treeIdOf(first!)!;
    forest.removeTree(first!);
    expect(treeIdOf(first!)).toBeUndefined();
    // The last tree took the removed tree's slot, and with it its ID.
    expect(treeFromId(firstId)).toBe(forest.trees.at(-1));
    for (const tree of forest.trees) expect(treeFromId(treeIdOf(tree)!)).toBe(tree);
    expect(treeFromId(treeIdOf(second!)!)).toBe(second);
    // The ID of the slot that is now empty resolves to nothing.
    expect(treeFromId(firstId + forest.size)).toBeUndefined();
  });

  it('resolves every tree after a Variant grows past its capacity', () => {
    const forest = createForest(definition, grid(4), { variants: 1 });
    const variant = forest.variants[0]!;
    const oldIds = forest.trees.map((t) => treeIdOf(t)!);
    const capacity = variant.capacity;
    for (let i = 0; i < capacity; i++) forest.addTree({ id: `extra-${i}`, position: [i, 0, 50] });
    expect(variant.capacity).toBeGreaterThan(capacity);
    const ids = forest.trees.map((t) => treeIdOf(t)!);
    expect(new Set(ids).size).toBe(forest.size);
    for (const [i, tree] of forest.trees.entries()) expect(treeFromId(ids[i]!)).toBe(tree);
    // The old block belongs to meshes that are no longer drawn.
    for (const id of oldIds) expect(ids).not.toContain(id);
    for (const id of oldIds) expect(treeFromId(id)).toBeUndefined();
  });

  it('resolves 0 (not a tree), unknown IDs and trees of a disposed Forest to undefined', () => {
    expect(treeFromId(0)).toBeUndefined();
    expect(treeFromId(-1)).toBeUndefined();
    expect(treeFromId(1.5)).toBeUndefined();
    expect(treeFromId(0xffffffff)).toBeUndefined();
    const forest = createForest(definition, grid(3), { variants: 1 });
    const tree = forest.trees[0]!;
    const id = treeIdOf(tree)!;
    forest.dispose();
    expect(treeFromId(id)).toBeUndefined();
    expect(treeIdOf(tree)).toBeUndefined();
  });

  it('does not keep disposed trees alive', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const collected: string[] = [];
    const watcher = new FinalizationRegistry<string>((name) => collected.push(name));
    (() => {
      const tree = createTree(definition, { seed: 3 });
      const forest = createForest(definition, grid(3), { variants: 1 });
      treeIdOf(tree);
      treeIdOf(forest.trees[0]!);
      watcher.register(tree, 'tree');
      watcher.register(forest, 'forest');
      tree.dispose();
      forest.dispose();
    })();
    for (let i = 0; i < 20 && collected.length < 2; i++) {
      gc();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(collected.sort()).toEqual(['forest', 'tree']);
  });

  it('is an opt-in MRT target of one 32-bit unsigned integer per pixel', () => {
    expect(TREE_ID).toBe('treeId');
    expect(Object.keys(treeIdMRT().outputNodes)).toEqual([TREE_ID]);
    const scenePass = pass(new Scene(), new PerspectiveCamera());
    scenePass.setMRT(mrt({ output }).merge(treeMaskMRT()).merge(treeIdMRT()));
    const texture = treeIdTexture(scenePass);
    expect(texture).toBe(scenePass.getTexture(TREE_ID));
    expect(texture).toMatchObject({ format: RedIntegerFormat, type: UnsignedIntType, magFilter: NearestFilter, minFilter: NearestFilter });
    // The tree mask's own pass is unchanged: no ID target unless asked for.
    expect(Object.keys(treeEffectsPass(new Scene(), new PerspectiveCamera()).pass.getMRT()!.outputNodes)).toEqual(['output', TREE_MASK]);
  });
});
