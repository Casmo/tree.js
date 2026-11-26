// Leaf Translucency (#56, a Material Feature, ADR 0008): only when `materials.leaf.translucency` is set
// does the leaf material get a translucent lighting model; bark and Fruit never do.
import { describe, expect, it } from 'vitest';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { createForest, createTree, type Shading, type TreeDefinitionInput } from '../src/index';

const SHADINGS: Shading[] = ['flat', 'standard', 'toon', 'whimsical', 'enchanted'];
const TRANSLUCENCY = { strength: 0.6, edge: 0.7, ambient: 0.3 };

/** A small tree with Fruit, in one shading, optionally with Leaf Translucency. */
const definition = (shading: Shading, translucency?: typeof TRANSLUCENCY): TreeDefinitionInput => ({
  schemaVersion: 3,
  branches: [{ count: 3 }],
  leaves: { count: 2 },
  fruit: { type: 'round', count: 2, size: 0.12, hang: 0.7 },
  materials: { shading, leaf: translucency ? { translucency } : {} },
});

/** The lighting model a material lights with (what the renderer gets from it). */
const lightingModel = (material: MeshStandardNodeMaterial): object =>
  material.setupLightingModel() as unknown as object;

const isTranslucent = (material: MeshStandardNodeMaterial): boolean =>
  (lightingModel(material) as { isLeafTranslucencyModel?: boolean }).isLeafTranslucencyModel === true;

/** The Tree's and a Forest Variant's bark, leaf and Fruit materials. */
function materials(input: TreeDefinitionInput) {
  const tree = createTree(input, { seed: 3 });
  const forest = createForest(input, [{ position: [0, 0, 0] }], { variants: 1, seed: 3 });
  const variant = forest.variants[0]!;
  return {
    tree: { bark: tree.wood.material as MeshStandardNodeMaterial, leaf: tree.leaves.material, fruit: tree.fruit.material },
    forest: { bark: variant.barkMaterial, leaf: variant.leafMaterial, fruit: variant.fruitMaterial! },
  };
}

describe.each(SHADINGS)('Leaf Translucency in %s shading', (shading) => {
  const off = materials(definition(shading));
  const on = materials(definition(shading, TRANSLUCENCY));

  it.each(['tree', 'forest'] as const)('off: the %s materials keep their class and lighting model', (kind) => {
    for (const part of ['bark', 'leaf', 'fruit'] as const) {
      const before = off[kind][part];
      const after = on[kind][part];
      expect(isTranslucent(before), part).toBe(false);
      expect(after.constructor, part).toBe(before.constructor);
    }
    // Off, every part lights with the same model as a plain material of that shading.
    const plainModel = lightingModel(off[kind].bark).constructor;
    expect(lightingModel(off[kind].leaf).constructor).toBe(plainModel);
    expect(lightingModel(off[kind].fruit).constructor).toBe(plainModel);
  });

  it.each(['tree', 'forest'] as const)('on: only the %s leaves get the translucent lighting model', (kind) => {
    expect(isTranslucent(on[kind].leaf)).toBe(true);
    expect(isTranslucent(on[kind].bark)).toBe(false);
    expect(isTranslucent(on[kind].fruit)).toBe(false);
    // Still a lighting model of the same family (physical for flat/standard, soft toon for toon).
    expect(lightingModel(on[kind].leaf)).toBeInstanceOf(lightingModel(off[kind].leaf).constructor);
  });
});
