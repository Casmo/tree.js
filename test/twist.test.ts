import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three/webgpu';
import { bakeTree, createTree, extendDefinition, type TreeDefinition } from '../src/index';
import { generateLightTree, generateTree } from '../src/generator';
import lowPoly from '../src/styles/low-poly';
import realistic from '../src/styles/realistic';

/** A Style's broadleaf with Twist on every branch level. */
const twisted = (definition: TreeDefinition, twist = 0.7, twists = 3) =>
  extendDefinition(definition, { branches: definition.branches.map((level) => ({ ...level, twist, twists })) });

describe('Twisted trees downstream', () => {
  it('grow, change with the Season and carry Wind attributes like any tree', () => {
    const definition = twisted(lowPoly.broadleaf);
    const data = generateTree(definition, 3);
    expect(data.growth.branches).toHaveLength(data.skeleton.branches.length);
    for (const name of Object.keys(data.wood.attributes)) {
      expect(data.wood.attributes[name]!.array.every(Number.isFinite), name).toBe(true);
    }
    const young = createTree(definition, { seed: 3, growth: 0.3, season: 0.6 });
    expect(young.growth).toBe(0.3);
    young.dispose();
  });

  it('keep their Twist on the Light Detail Level: twisted branches are swept with at least 3 Sections per turn', () => {
    const wood = (definition: TreeDefinition) => generateLightTree(definition, 3).wood.positions.length;
    // Low-poly branches have 1–2 Sections: halving them would straighten a Twist again.
    expect(wood(twisted(lowPoly.broadleaf))).toBeGreaterThan(wood(lowPoly.broadleaf) * 1.5);
  });

  it('bake into static meshes at any Growth', () => {
    const tree = createTree(twisted(realistic.broadleaf), { seed: 3 });
    for (const growth of [0.2, 1]) {
      const wood = bakeTree(tree, { growth }).getObjectByName('wood') as Mesh;
      const positions = wood.geometry.getAttribute('position').array;
      expect(positions.length).toBeGreaterThan(0);
      expect(Array.from(positions).every(Number.isFinite)).toBe(true);
    }
    tree.dispose();
  });
});
