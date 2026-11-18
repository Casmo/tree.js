// Material Features tuned live (#54 "changing the amount does not regenerate the tree", ADR 0008): a
// Tree or Forest whose Definition has Crown Normals or Leaf Translucency on takes new values as uniforms,
// like `occlusionStrength`; switching a feature on still needs a new tree.
import { describe, expect, it } from 'vitest';
import { Mesh } from 'three/webgpu';
import { bakeTree, createForest, createTree, withMaterialFeatures, type TreeDefinition } from '../src/index';
import { oak } from '../src/species';
import lowPoly from '../src/styles/low-poly';
import stylized from '../src/styles/stylized';

const TRANSLUCENCY = { strength: 0.6, edge: 0.7, ambient: 0.3 };
const ON = withMaterialFeatures(stylized.apply(oak), { crownNormals: 0.5, translucency: TRANSLUCENCY });
const OFF = stylized.apply(oak);

const forestOf = (definition: TreeDefinition) => createForest(definition, [{ position: [0, 0, 0] }], { variants: 2, seed: 3 });

describe('Crown Normals amount, live', () => {
  it('reads the amount of the Definition, null when the feature is off', () => {
    const tree = createTree(ON, { seed: 3 });
    const forest = forestOf(ON);
    expect(tree.crownNormals).toBe(0.5);
    expect(forest.crownNormals).toBe(0.5);
    const plain = createTree(OFF, { seed: 3 });
    expect(plain.crownNormals).toBeNull();
    expect(forestOf(OFF).crownNormals).toBeNull();
    for (const t of [tree, plain]) t.dispose();
  });

  it('retunes without regenerating the tree or replacing its normal node', () => {
    const tree = createTree(ON, { seed: 3 });
    const { data } = tree;
    const geometry = tree.leaves.geometry;
    const normalNode = tree.leaves.material.normalNode;
    tree.crownNormals = 0.9;
    expect(tree.crownNormals).toBeCloseTo(0.9);
    expect(tree.data).toBe(data);
    expect(tree.leaves.geometry).toBe(geometry);
    expect(tree.leaves.material.normalNode).toBe(normalNode);
    tree.dispose();

    const forest = forestOf(ON);
    const variants = forest.variants;
    const nodes = variants.map((v) => v.leafMaterial.normalNode);
    forest.crownNormals = 0.2;
    expect(forest.crownNormals).toBeCloseTo(0.2);
    expect(forest.variants).toBe(variants);
    expect(forest.variants.map((v) => v.leafMaterial.normalNode)).toEqual(nodes);
    forest.dispose();
  });

  it('clamps to 0..1, and cannot be set on a tree without Crown Normals', () => {
    const tree = createTree(ON, { seed: 3 });
    tree.crownNormals = 3;
    expect(tree.crownNormals).toBe(1);
    tree.crownNormals = -1;
    expect(tree.crownNormals).toBe(0);
    tree.dispose();
    const plain = createTree(OFF, { seed: 3 });
    expect(() => (plain.crownNormals = 0.5)).toThrow(/materials\.leaf\.crownNormals/);
    expect(() => (forestOf(OFF).crownNormals = 0.5)).toThrow(/materials\.leaf\.crownNormals/);
    plain.dispose();
  });

  it('a Baked Tree is baked with the amount as tuned', () => {
    const card = withMaterialFeatures(lowPoly.apply(oak), { crownNormals: 0.3 });
    const tuned = createTree(card, { seed: 2 });
    tuned.crownNormals = 1;
    const fresh = createTree(withMaterialFeatures(card, { crownNormals: 1 }), { seed: 2 });
    const normals = (tree: typeof fresh) =>
      Array.from((bakeTree(tree).getObjectByName('leaves') as Mesh).geometry.getAttribute('normal').array);
    expect(normals(tuned)).toEqual(normals(fresh));
    expect((bakeTree(tuned).getObjectByName('leaves') as Mesh).material).toMatchObject({ userData: { treejs: { crownNormals: 1 } } });
    for (const t of [tuned, fresh]) t.dispose();
  });
});

describe('Leaf Translucency settings, live', () => {
  it('reads the settings of the Definition, null when the feature is off', () => {
    const tree = createTree(ON, { seed: 3 });
    expect(tree.translucency).toEqual(TRANSLUCENCY);
    expect(forestOf(ON).translucency).toEqual(TRANSLUCENCY);
    const plain = createTree(OFF, { seed: 3 });
    expect(plain.translucency).toBeNull();
    expect(forestOf(OFF).translucency).toBeNull();
    for (const t of [tree, plain]) t.dispose();
  });

  it('retunes any of the values (the others kept) without regenerating the tree or rebuilding its lighting model', () => {
    const tree = createTree(ON, { seed: 3 });
    const { data } = tree;
    const lighting = tree.leaves.material.setupLightingModel;
    tree.translucency = { strength: 0.9 };
    expect(tree.translucency).toEqual({ ...TRANSLUCENCY, strength: 0.9 });
    tree.translucency = { edge: 0.1, ambient: 0.8 };
    expect(tree.translucency).toEqual({ strength: 0.9, edge: 0.1, ambient: 0.8 });
    expect(tree.data).toBe(data);
    expect(tree.leaves.material.setupLightingModel).toBe(lighting);
    tree.dispose();

    const forest = forestOf(ON);
    const variants = forest.variants;
    forest.translucency = { ...TRANSLUCENCY, ambient: 0 };
    expect(forest.translucency).toEqual({ ...TRANSLUCENCY, ambient: 0 });
    expect(forest.variants).toBe(variants);
    forest.dispose();
  });

  it('the value read back is a copy: changing it does not change the tree', () => {
    const tree = createTree(ON, { seed: 3 });
    const read = tree.translucency!;
    read.strength = 0;
    expect(tree.translucency!.strength).toBe(TRANSLUCENCY.strength);
    tree.dispose();
  });

  it('clamps each value to 0..1, and cannot be set on a tree without Leaf Translucency', () => {
    const tree = createTree(ON, { seed: 3 });
    tree.translucency = { strength: 2, edge: -1 };
    expect(tree.translucency).toEqual({ strength: 1, edge: 0, ambient: TRANSLUCENCY.ambient });
    tree.dispose();
    const plain = createTree(OFF, { seed: 3 });
    expect(() => (plain.translucency = { strength: 0.5 })).toThrow(/materials\.leaf\.translucency/);
    expect(() => (forestOf(OFF).translucency = { strength: 0.5 })).toThrow(/materials\.leaf\.translucency/);
    plain.dispose();
  });

  it('a Baked Tree is baked with the settings as tuned', () => {
    const tree = createTree(ON, { seed: 3 });
    tree.translucency = { strength: 0.25 };
    const leaves = bakeTree(tree).getObjectByName('leaves') as Mesh;
    expect(leaves.material).toMatchObject({ userData: { treejs: { translucency: { ...TRANSLUCENCY, strength: 0.25 } } } });
    tree.dispose();
  });
});
