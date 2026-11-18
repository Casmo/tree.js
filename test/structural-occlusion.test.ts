// Structural Occlusion (#55, GLOSSARY): with `materials.occlusion` set, the Generator bakes a per-vertex
// `aOcclusion` (0 = occluded, 1 = open) into the wood, leaf and Fruit buffers, from the tree's own shape.
import { describe, expect, it } from 'vitest';
import type { Material, NodeMaterial } from 'three/webgpu';
import { generateTree } from '../src/generator';
import { createForest, createTree, crownDistance, extendDefinition, hashTreeData, type TreeData, type TreeDefinition, type Vec3 } from '../src/index';
import { juniper, oak, pear, spruce } from '../src/species';
import lowPoly from '../src/styles/low-poly';
import realistic from '../src/styles/realistic';
import stylized from '../src/styles/stylized';

const STYLES = [lowPoly, stylized, realistic];
const withOcclusion = (definition: TreeDefinition, strength = 0.7): TreeDefinition =>
  extendDefinition(definition, { materials: { occlusion: { strength } } });
const parts = (data: TreeData) => [data.wood, data.leaves, data.fruit] as const;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Every vertex of a buffer with its position, aLevel and baked occlusion. */
function vertices(buffers: TreeData['wood']) {
  const p = buffers.positions;
  return Array.from({ length: p.length / 3 }, (_, v) => ({
    p: [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!] as Vec3,
    level: buffers.attributes.aLevel.array[v]!,
    occlusion: buffers.attributes.aOcclusion?.array[v] ?? 1,
  }));
}

/** Trunk (and other Stem) vertices above the ground and below the middle of the crown. */
const trunkUnderCrown = (data: TreeData, crown = data.crown) =>
  vertices(data.wood).filter((v) => v.level === 0 && v.p[1] > 0 && v.p[1] < crown.center[1]);

const CASES = STYLES.flatMap((style) => [oak, spruce, juniper].map((s) => [`${style.name} ${s.id}`, style.apply(s)] as const));

describe('Structural Occlusion bake', () => {
  it.each(STYLES.map((s) => [s.name, s] as const))('adds aOcclusion to wood, leaves and Fruit only when it is set (%s)', (_, style) => {
    const plain = style.apply(pear);
    const off = generateTree(plain, 3);
    const on = generateTree(withOcclusion(plain), 3);
    for (const buffers of parts(off)) expect(buffers.attributes).not.toHaveProperty('aOcclusion');
    expect(on.fruit.positions.length).toBeGreaterThan(0);
    for (const buffers of parts(on)) {
      expect(buffers.attributes.aOcclusion!.itemSize).toBe(1);
      expect(buffers.attributes.aOcclusion!.array.length).toBe(buffers.positions.length / 3);
    }
    // Only the attribute is added: the rest of the geometry is untouched.
    for (const [a, b] of parts(off).map((p, i) => [p, parts(on)[i]!] as const)) {
      expect(b.positions).toEqual(a.positions);
      expect(b.normals).toEqual(a.normals);
      expect(Object.keys(b.attributes).filter((k) => k !== 'aOcclusion')).toEqual(Object.keys(a.attributes));
    }
    expect(hashTreeData(on)).not.toBe(hashTreeData(off));
  });

  it('keeps every value in 0..1', () => {
    for (const style of STYLES) {
      const data = generateTree(withOcclusion(style.apply(oak)), 5);
      for (const buffers of parts(data)) {
        for (const value of buffers.attributes.aOcclusion?.array ?? []) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it.each(CASES)('darkens the inner crown more than its shell (%s)', (_, definition) => {
    const data = generateTree(withOcclusion(definition), 5);
    const leaves = vertices(data.leaves);
    const inner = leaves.filter((v) => crownDistance(data.crown, v.p) < 0.5).map((v) => v.occlusion);
    const shell = leaves.filter((v) => crownDistance(data.crown, v.p) > 0.9).map((v) => v.occlusion);
    expect(inner.length).toBeGreaterThan(0);
    expect(shell.length).toBeGreaterThan(0);
    expect(mean(inner)).toBeLessThan(mean(shell) - 0.1);
  });

  it.each(CASES)('darkens the trunk under the crown, where a leafless tree is open (%s)', (_, definition) => {
    const leafy = generateTree(withOcclusion(definition), 5);
    const leafless = generateTree(withOcclusion(extendDefinition(definition, { leaves: { count: 0 } })), 5);
    expect(leafless.leaves.positions.length).toBe(0);
    const under = trunkUnderCrown(leafy).map((v) => v.occlusion);
    const bare = trunkUnderCrown(leafless, leafy.crown).map((v) => v.occlusion);
    expect(under.length).toBeGreaterThan(0);
    expect(bare.length).toBe(under.length);
    expect(Math.max(...under)).toBeLessThan(1);
    expect(mean(under)).toBeLessThan(mean(bare) - 0.2);
  });

  it('is identical for the same Seed and different for another', () => {
    const definition = withOcclusion(stylized.apply(oak));
    const a = generateTree(definition, 9);
    const b = generateTree(definition, 9);
    const c = generateTree(definition, 10);
    for (const [i, part] of parts(a).entries()) expect(parts(b)[i]!.attributes.aOcclusion).toEqual(part.attributes.aOcclusion);
    expect(hashTreeData(a)).toBe(hashTreeData(b));
    expect(c.leaves.attributes.aOcclusion).not.toEqual(a.leaves.attributes.aOcclusion);
  });

  it('does not depend on strength (the material mixes it in)', () => {
    const definition = realistic.apply(pear);
    const weak = generateTree(withOcclusion(definition, 0.1), 2);
    const strong = generateTree(withOcclusion(definition, 1), 2);
    const none = generateTree(withOcclusion(definition, 0), 2);
    expect(hashTreeData(weak)).toBe(hashTreeData(strong));
    expect(hashTreeData(none)).toBe(hashTreeData(strong));
  });

  it('is baked for the fully grown tree with every leaf on, whatever the Season Profile', () => {
    const definition = withOcclusion(lowPoly.apply(oak));
    const bareAllYear = extendDefinition(definition, { season: { leafCoverage: [{ t: 0, value: 0 }] } });
    expect(hashTreeData(generateTree(bareAllYear, 4))).toBe(hashTreeData(generateTree(definition, 4)));
  });
});

describe('Structural Occlusion materials', () => {
  const SHADINGS = ['flat', 'standard', 'toon'] as const;
  const definitionFor = (shading: (typeof SHADINGS)[number]) => extendDefinition(lowPoly.apply(pear), { materials: { shading } });
  const aoOf = (material: Material | null | undefined) => (material as NodeMaterial).aoNode;
  const treeMaterials = (definition: TreeDefinition) => {
    const tree = createTree(definition, { seed: 3 });
    return { tree, materials: [tree.wood.material, tree.leaves.material, tree.fruit.material] };
  };
  const forestMaterials = (definition: TreeDefinition) => {
    const forest = createForest(definition, [{ position: [0, 0, 0] }, { position: [5, 0, 0] }], { variants: 2 });
    return { forest, materials: forest.variants.flatMap((v) => [v.barkMaterial, v.leafMaterial, v.fruitMaterial]) };
  };

  it.each(SHADINGS)('leave wood, leaves and Fruit without an aoNode when it is not set (%s)', (shading) => {
    const { tree, materials } = treeMaterials(definitionFor(shading));
    const { forest, materials: forestOnes } = forestMaterials(definitionFor(shading));
    expect(forestOnes.every((m) => m !== null)).toBe(true);
    for (const material of [...materials, ...forestOnes]) expect(aoOf(material)).toBeNull();
    expect(tree.occlusionStrength).toBeNull();
    expect(forest.occlusionStrength).toBeNull();
    tree.dispose();
    forest.dispose();
  });

  it.each(SHADINGS)('set an aoNode on wood, leaves and Fruit of a Tree and every Forest Variant (%s)', (shading) => {
    const definition = withOcclusion(definitionFor(shading), 0.6);
    const { tree, materials } = treeMaterials(definition);
    const { forest, materials: forestOnes } = forestMaterials(definition);
    expect(forestOnes).toHaveLength(6);
    for (const material of [...materials, ...forestOnes]) expect(aoOf(material)).not.toBeNull();
    expect(tree.occlusionStrength).toBeCloseTo(0.6);
    expect(forest.occlusionStrength).toBeCloseTo(0.6);
    // Each Variant has its own bake.
    const [a, b] = forest.variants;
    expect(a!.data.leaves.attributes.aOcclusion).toBeDefined();
    expect(b!.data.leaves.attributes.aOcclusion).not.toEqual(a!.data.leaves.attributes.aOcclusion);
    tree.dispose();
    forest.dispose();
  });

  it('retunes strength without regenerating the tree or rebuilding its materials', () => {
    const { tree, materials } = treeMaterials(withOcclusion(definitionFor('toon'), 0.6));
    const { data, wood } = tree;
    const geometry = wood.geometry;
    const nodes = materials.map(aoOf);
    tree.occlusionStrength = 0.2;
    expect(tree.occlusionStrength).toBeCloseTo(0.2);
    expect(tree.data).toBe(data);
    expect(tree.wood.geometry).toBe(geometry);
    expect([tree.wood.material, tree.leaves.material, tree.fruit.material].map(aoOf)).toEqual(nodes);
    tree.dispose();

    const { forest } = forestMaterials(withOcclusion(definitionFor('flat'), 0.6));
    const variants = forest.variants;
    forest.occlusionStrength = 1;
    expect(forest.occlusionStrength).toBe(1);
    expect(forest.variants).toBe(variants);
    forest.dispose();
  });

  it('clamps strength to 0..1, and cannot be set on a tree without Structural Occlusion', () => {
    const { tree } = treeMaterials(withOcclusion(definitionFor('standard')));
    tree.occlusionStrength = 2;
    expect(tree.occlusionStrength).toBe(1);
    tree.occlusionStrength = -1;
    expect(tree.occlusionStrength).toBe(0);
    tree.dispose();
    const { tree: plain } = treeMaterials(definitionFor('standard'));
    expect(() => (plain.occlusionStrength = 0.5)).toThrow(/materials\.occlusion/);
    plain.dispose();
  });
});
