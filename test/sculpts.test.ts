import { describe, expect, it } from 'vitest';
import { createTree, hashGeometry, type TreeDefinitionInput } from '../src/index';

/** A Definition as it would be saved by the Tree Editor: hand edits made on Seed 5. */
const saved = JSON.stringify({
  schemaVersion: 2,
  sculpts: [
    { seed: 5, path: '0.1', action: 'delete' },
    { seed: 5, path: '0.2', action: 'move', rotation: [0, 0.5, 0.4], scale: 1.2 },
    { seed: 5, path: '0.3', action: 'leaves', coverage: 0.3 },
  ],
});
const plain: TreeDefinitionInput = { schemaVersion: 2 };
const woodHash = (tree: ReturnType<typeof createTree>) => hashGeometry(tree.data.wood);

describe('Sculpted trees (public API)', () => {
  it('load from a saved Definition and change only the tree of their Seed', () => {
    const sculptedTree = createTree(JSON.parse(saved) as TreeDefinitionInput, { seed: 5 });
    expect(sculptedTree.definition.sculpts).toHaveLength(3);
    expect(woodHash(sculptedTree)).not.toBe(woodHash(createTree(plain, { seed: 5 })));
    expect(woodHash(createTree(JSON.parse(saved) as TreeDefinitionInput, { seed: 6 }))).toBe(
      woodHash(createTree(plain, { seed: 6 })),
    );
  });

  it('keep responding to Growth, Season and Wind', () => {
    const tree = createTree(JSON.parse(saved) as TreeDefinitionInput, { seed: 5, growth: 0.3, season: 0.6 });
    tree.growth = 0.8;
    tree.season = 0.9;
    tree.windResponse.set({ branches: 1 });
    expect(tree.growthUniform.value).toBe(0.8);
    expect(tree.seasonUniform.value).toBeCloseTo(0.9);
    for (const mesh of [tree.wood, tree.leaves]) {
      expect((mesh.material as unknown as { positionNode: unknown }).positionNode).toBeTruthy();
      for (const name of ['aGrowth', 'aSeason', 'aWind']) expect(mesh.geometry.getAttribute(name).count).toBeGreaterThan(0);
    }
    tree.dispose();
  });
});
