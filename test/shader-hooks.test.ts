// Tree Shader Hook on a single Tree (#98, ADR 0012, GLOSSARY): the app hands the library a TSL function per
// tree part; the library applies it inside that part's node material. Setting, changing and removing a hook
// rebuilds the node graph only, never the geometry; with no hook the materials are as before (ADR 0008).
import { describe, expect, it, vi } from 'vitest';
import { vec3 } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';
import { createTree, type Tree, type TreeShaderHook, type TreeShaderInput } from '../src/index';
import { pear } from '../src/species';
import lowPoly from '../src/styles/low-poly';
import stylized from '../src/styles/stylized';

const PARTS = ['bark', 'leaves', 'fruit'] as const;
const materialsOf = (tree: Tree) => ({ bark: tree.wood.material as MeshStandardNodeMaterial, leaves: tree.leaves.material, fruit: tree.fruit.material });

/** What a material's shading is built from: the nodes a hook replaces, and the vertex-colour switch. */
const shadingState = (tree: Tree) =>
  Object.fromEntries(
    Object.entries(materialsOf(tree)).map(([part, m]) => [
      part,
      { colorNode: m.colorNode, roughnessNode: m.roughnessNode, vertexColors: m.vertexColors },
    ]),
  );

const tint: TreeShaderHook = ({ color }) => color.mul(vec3(1, 0, 1));

describe('Tree Shader Hook on a Tree', () => {
  it('is off unless set: a Tree starts with no hooks', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    expect(tree.shaderHooks).toEqual({});
    tree.dispose();
  });

  it.each(PARTS)('set on %s changes that part only, without touching the geometry', (part) => {
    const tree = createTree(stylized.apply(pear), { seed: 2, season: 0.45 });
    const before = shadingState(tree);
    const geometries = [tree.wood.geometry, tree.leaves.geometry, tree.fruit.geometry];
    const data = tree.data;
    const version = materialsOf(tree)[part].version;
    tree.shaderHooks = { [part]: tint };
    expect(tree.shaderHooks).toEqual({ [part]: tint });
    const after = shadingState(tree);
    for (const other of PARTS) {
      if (other === part) expect(after[other]!.colorNode).not.toBe(before[other]!.colorNode);
      else expect(after[other]).toEqual(before[other]);
    }
    expect(materialsOf(tree)[part].version).toBeGreaterThan(version); // the node graph is rebuilt
    expect([tree.wood.geometry, tree.leaves.geometry, tree.fruit.geometry]).toEqual(geometries);
    expect(tree.data).toBe(data);
    tree.dispose();
  });

  it('receives the base colour, world normal, world positions, Season, Growth, part and shading', () => {
    const tree = createTree(lowPoly.apply(pear), { seed: 2 });
    const hook = vi.fn<TreeShaderHook>(({ color }) => color);
    tree.shaderHooks = { bark: hook, leaves: hook, fruit: hook };
    expect(hook).toHaveBeenCalledTimes(3);
    const inputs = hook.mock.calls.map(([input]) => input);
    expect(inputs.map((i) => i.part)).toEqual(['bark', 'leaves', 'fruit']);
    for (const input of inputs) {
      expect(input.shading).toBe('flat');
      expect(input.season).toBe(tree.seasonUniform);
      expect(input.growth).toBe(tree.growthUniform);
      for (const key of ['color', 'roughness', 'normal', 'position', 'treePosition'] as const) {
        expect((input[key] as Node).isNode, key).toBe(true);
      }
    }
    tree.dispose();
  });

  it('may return a roughness as well as a colour', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    const before = tree.leaves.material.roughnessNode;
    tree.shaderHooks = { leaves: ({ color }) => color };
    expect(tree.leaves.material.roughnessNode).toBe(before); // a colour only keeps the roughness
    tree.shaderHooks = { leaves: ({ color, roughness }: TreeShaderInput) => ({ color, roughness: roughness.mul(0.2) }) };
    expect(tree.leaves.material.roughnessNode).not.toBe(before);
    expect((tree.leaves.material.roughnessNode as Node).isNode).toBe(true);
    tree.dispose();
  });

  it('is given at creation as an option', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: { leaves: tint } });
    const plain = createTree(stylized.apply(pear), { seed: 2 });
    expect(tree.shaderHooks).toEqual({ leaves: tint });
    expect(tree.leaves.material.colorNode).not.toBe(plain.leaves.material.colorNode);
    for (const t of [tree, plain]) t.dispose();
  });

  it('changes and is removed at runtime: removing restores the materials exactly', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2, season: 0.45 });
    const before = shadingState(tree);
    const geometries = [tree.wood.geometry, tree.leaves.geometry, tree.fruit.geometry];
    const first = vi.fn<TreeShaderHook>(({ color }) => color.mul(0.5));
    const second = vi.fn<TreeShaderHook>(({ color, roughness }) => ({ color: color.mul(2), roughness }));
    tree.shaderHooks = { leaves: first, fruit: first };
    const withFirst = shadingState(tree);
    expect(first).toHaveBeenCalledTimes(2);

    // Changing one part rebuilds that part only.
    const barkVersion = tree.wood.material.version;
    const fruitVersion = tree.fruit.material.version;
    tree.shaderHooks = { leaves: second, fruit: first };
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
    expect(tree.fruit.material.version).toBe(fruitVersion);
    expect(tree.wood.material.version).toBe(barkVersion);
    expect(shadingState(tree).fruit).toEqual(withFirst.fruit);
    expect(shadingState(tree).leaves!.colorNode).not.toBe(withFirst.leaves!.colorNode);

    const leafVersion = tree.leaves.material.version;
    tree.shaderHooks = {};
    expect(tree.shaderHooks).toEqual({});
    expect(shadingState(tree)).toEqual(before);
    for (const key of ['bark', 'leaves', 'fruit'] as const) expect(shadingState(tree)[key]!.colorNode).toBe(before[key]!.colorNode);
    expect(tree.leaves.material.version).toBeGreaterThan(leafVersion);
    expect([tree.wood.geometry, tree.leaves.geometry, tree.fruit.geometry]).toEqual(geometries);
    tree.dispose();
  });

  it('removing a part by setting it to undefined keeps the others', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    tree.shaderHooks = { bark: tint, leaves: tint };
    tree.shaderHooks = { ...tree.shaderHooks, bark: undefined };
    expect(tree.shaderHooks).toEqual({ leaves: tint });
    tree.dispose();
  });
});
