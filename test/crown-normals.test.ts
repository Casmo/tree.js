// Crown Normals (#54): `materials.leaf.crownNormals` (0..1) blends the leaf material's normal towards
// the Crown Volume's normal. Off (absent or 0), the materials are exactly today's.
import { describe, expect, it } from 'vitest';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { createForest, createTree, extendDefinition, hashTreeData, parseDefinition, type Shading, type TreeDefinition } from '../src/index';
import { generateTree } from '../src/generator';
import { oak } from '../src/species';
import lowPoly from '../src/styles/low-poly';

const SHADINGS: Shading[] = ['flat', 'standard', 'toon'];

const define = (shading: Shading, crownNormals?: number): TreeDefinition =>
  extendDefinition(lowPoly.apply(oak), { materials: { shading, leaf: crownNormals === undefined ? {} : { crownNormals } } });

/** The leaf, bark and Fruit materials of a Tree and of the first Variant of a Forest. */
function materials(definition: TreeDefinition) {
  const tree = createTree(definition, { seed: 3 });
  const forest = createForest(definition, [{ position: [0, 0, 0] }], { variants: 1, seed: 3 });
  const variant = forest.variants[0]!;
  const out = {
    tree: { leaf: tree.leaves.material, bark: tree.wood.material as MeshStandardNodeMaterial, fruit: tree.fruit.material },
    forest: { leaf: variant.leafMaterial, bark: variant.barkMaterial, fruit: variant.fruitMaterial },
  };
  return { ...out, dispose: () => (tree.dispose(), forest.dispose()) };
}

describe.each(SHADINGS)('Crown Normals in %s shading', (shading) => {
  it('off (absent or 0): no normal override on any material of a Tree or Forest', () => {
    for (const amount of [undefined, 0]) {
      const m = materials(define(shading, amount));
      for (const part of [m.tree, m.forest]) {
        expect(part.leaf.normalNode).toBeNull();
        expect(part.bark.normalNode).toBeNull();
        expect(part.fruit?.normalNode ?? null).toBeNull();
      }
      m.dispose();
    }
  });

  it('on: the leaf material of a Tree and a Forest gets the normal blend, bark and Fruit do not', () => {
    const off = materials(define(shading));
    const on = materials(define(shading, 0.6));
    for (const key of ['tree', 'forest'] as const) {
      expect(on[key].leaf.normalNode).not.toBeNull();
      expect(on[key].bark.normalNode).toBeNull();
      expect(on[key].fruit?.normalNode ?? null).toBeNull();
      // Same material class, shading and lighting model as without the feature.
      expect(on[key].leaf.constructor).toBe(off[key].leaf.constructor);
      expect(on[key].leaf.flatShading).toBe(shading === 'flat');
      expect(on[key].leaf.setupLightingModel().constructor).toBe(off[key].leaf.setupLightingModel().constructor);
    }
    off.dispose();
    on.dispose();
  });
});

describe('Crown Normals and the Generator', () => {
  it('changing the amount does not change the generated tree (no regeneration needed)', () => {
    const hash = (crownNormals?: number) => hashTreeData(generateTree(define('standard', crownNormals), 5));
    expect(hash(0.3)).toBe(hash());
    expect(hash(1)).toBe(hash());
  });

  it('is part of a parsed Definition', () => {
    expect(parseDefinition({ schemaVersion: 3, materials: { leaf: { crownNormals: 0.5 } } }).materials.leaf.crownNormals).toBe(0.5);
  });
});
