// Painterly with the opt-in layers (#119, ADR 0008 / 0012 / 0014): Material Features and Tree Shader Hooks
// apply on top of the painted shading (the painted crown gradient stays), Tree Effects see its parts, and
// every suggested-settings table has a painterly entry.
import { describe, expect, it, vi } from 'vitest';
import { vec3 } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node, NodeMaterial } from 'three/webgpu';
import {
  createForest,
  createTree,
  SUGGESTED_MATERIAL_FEATURES,
  withMaterialFeatures,
  type Tree,
  type TreeDefinition,
  type TreeShaderHook,
} from '../../src/index';
import { SUGGESTED_TREE_EFFECTS, treePartOf } from '../../src/effects';
import { SUGGESTED_SCENE_EFFECTS } from '../../src/scene';
import { PaintedNodeMaterial } from '../../src/materials';
import painterly from '../../src/styles/painterly';
import { oak } from '../../src/species';

const painted = (material: unknown) => material as PaintedNodeMaterial;
const FEATURES = { crownNormals: 0.5, translucency: { strength: 0.4, edge: 0.6, ambient: 0.2 }, occlusion: { strength: 0.7 } };

/** The bark, leaf and Fruit materials of a Tree and of every Variant of a small Forest. */
function materials(definition: TreeDefinition) {
  const tree = createTree(definition, { seed: 3 });
  const forest = createForest(definition, [{ position: [0, 0, 0] }, { position: [4, 0, 0] }], { variants: 2, seed: 3 });
  const sets = [
    { bark: tree.wood.material as MeshStandardNodeMaterial, leaf: tree.leaves.material, fruit: tree.fruit.material },
    ...forest.variants.map((v) => ({ bark: v.barkMaterial, leaf: v.leafMaterial, fruit: v.fruitMaterial })),
  ];
  return { sets, dispose: () => (tree.dispose(), forest.dispose()) };
}

describe('suggested settings for painterly', () => {
  it('every suggested-settings table has a painterly entry', () => {
    expect(SUGGESTED_TREE_EFFECTS.painterly).toBeDefined();
    expect(SUGGESTED_SCENE_EFFECTS.painterly).toBeDefined();
    expect(SUGGESTED_MATERIAL_FEATURES.painterly).toBeDefined();
  });

  it('suggests no line effects and no bloom: painterly needs no post (ADR 0014)', () => {
    expect(SUGGESTED_TREE_EFFECTS.painterly.outline).toBeUndefined();
    expect(SUGGESTED_TREE_EFFECTS.painterly.innerLines).toBeUndefined();
    expect(SUGGESTED_SCENE_EFFECTS.painterly.bloom).toBeUndefined();
  });
});

describe.each([
  ['broadleaf', painterly.broadleaf],
  ['conifer', painterly.conifer],
  ['oak', painterly.apply(oak)],
] as const)('Material Features on a painterly %s', (_, base) => {
  it('apply on top of the painted shading, on a Tree and every Forest Variant', () => {
    const off = materials(base);
    const on = materials(withMaterialFeatures(base, FEATURES));
    for (const [i, set] of on.sets.entries()) {
      const plain = off.sets[i]!;
      // Still the painted shading, still painting the crown gradient.
      expect(set.leaf).toBeInstanceOf(PaintedNodeMaterial);
      expect(painted(set.leaf).paint).not.toBeNull();
      // Crown Normals start from the Leaf Mass's bent normal and blend it towards the crown's.
      expect(plain.leaf.normalNode).not.toBeNull();
      expect(set.leaf.normalNode).not.toBe(plain.leaf.normalNode);
      expect(set.bark.normalNode).toBeNull();
      // Leaf Translucency through the painted lighting model.
      expect(painted(plain.leaf).translucency).toBeNull();
      expect(painted(set.leaf).translucency).not.toBeNull();
      expect((set.leaf.setupLightingModel() as unknown as { isLeafTranslucencyModel: boolean }).isLeafTranslucencyModel).toBe(true);
      expect(painted(set.bark).translucency).toBeNull();
      // Structural Occlusion on every part.
      for (const m of [set.bark, set.leaf, set.fruit]) if (m) expect((m as NodeMaterial).aoNode).not.toBeNull();
      for (const m of [plain.bark, plain.leaf, plain.fruit]) if (m) expect((m as NodeMaterial).aoNode).toBeNull();
    }
    off.dispose();
    on.dispose();
  });

  it('the suggested ones apply too', () => {
    const tree = createTree(withMaterialFeatures(base, SUGGESTED_MATERIAL_FEATURES.painterly), { seed: 3 });
    expect(tree.materialFeatures).toEqual(SUGGESTED_MATERIAL_FEATURES.painterly);
    expect(painted(tree.leaves.material).paint).not.toBeNull();
    tree.dispose();
  });
});

describe('Tree Shader Hooks on a painterly Tree', () => {
  const partsOf = (tree: Tree) => ({ bark: tree.wood.material as MeshStandardNodeMaterial, leaves: tree.leaves.material, fruit: tree.fruit.material });

  it("get the 'painted' shading and the unpainted base colour of each part", () => {
    const tree = createTree(painterly.broadleaf, { seed: 2 });
    const hook = vi.fn<TreeShaderHook>(({ color }) => color);
    tree.shaderHooks = { bark: hook, leaves: hook, fruit: hook };
    expect(hook).toHaveBeenCalledTimes(3);
    for (const [input] of hook.mock.calls) {
      expect(input.shading).toBe('painted');
      for (const key of ['color', 'roughness', 'normal', 'position', 'treePosition'] as const) expect((input[key] as Node).isNode, key).toBe(true);
    }
    tree.dispose();
  });

  it('change the colour the crown gradient is painted from, and removing them restores the materials', () => {
    const tree = createTree(painterly.broadleaf, { seed: 2 });
    const { leaves, bark } = partsOf(tree);
    const before = { colorNode: leaves.colorNode, vertexColors: leaves.vertexColors, paint: painted(leaves).paint, normalNode: leaves.normalNode };
    const barkColor = bark.colorNode;
    tree.shaderHooks = { leaves: ({ color }) => color.mul(vec3(1, 0.4, 0.2)) };
    expect(leaves.colorNode).not.toBe(before.colorNode);
    // The hook's colour goes in before the painting: the crown is still painted, with its mass normals.
    expect(painted(leaves).paint).toBe(before.paint);
    expect(leaves.normalNode).toBe(before.normalNode);
    expect(bark.colorNode).toBe(barkColor);
    tree.shaderHooks = {};
    expect({ colorNode: leaves.colorNode, vertexColors: leaves.vertexColors, paint: painted(leaves).paint, normalNode: leaves.normalNode }).toEqual(before);
    tree.dispose();
  });

  it('reach a painterly Forest at Full Detail', () => {
    const forest = createForest(painterly.broadleaf, [{ position: [0, 0, 0] }], { variants: 1, seed: 1 });
    const leaf = forest.variants[0]!.leafMaterial;
    const before = leaf.colorNode;
    forest.shaderHooks = { leaves: ({ color }) => color.mul(0.5) };
    expect(leaf.colorNode).not.toBe(before);
    expect(painted(leaf).paint).not.toBeNull();
    forest.dispose();
  });
});

describe('Tree Effects on a painterly Tree', () => {
  it('see its bark, leaves and Fruit as tree parts', () => {
    const tree = createTree(painterly.apply(oak), { seed: 1 });
    expect(treePartOf(tree.wood.material as MeshStandardNodeMaterial)).toBe('bark');
    expect(treePartOf(tree.leaves.material)).toBe('leaves');
    expect(treePartOf(tree.fruit.material)).toBe('fruit');
    tree.dispose();
  });
});
