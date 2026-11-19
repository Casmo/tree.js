// Material Features on Impostors (#77, ADR 0008 / 0010): the bake adds the features' inputs only when
// the Definition sets one, the card material applies each feature that is on, and the Forest's live
// values reach the Impostors without a rebake.
import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, type MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { createForest, type Forest, type ForestPlacement, type TreeDefinitionInput } from '../src/index';

const base: TreeDefinitionInput = {
  schemaVersion: 3,
  trunk: { length: 5, lengthVariation: 0, bend: 0 },
  branches: [{ count: 3 }],
  leaves: { count: 2 },
};
const withMaterials = (materials: TreeDefinitionInput['materials']): TreeDefinitionInput => ({ ...base, materials });
const translucency = { strength: 0.6, edge: 0.4, ambient: 0.3 };
const placements: ForestPlacement[] = Array.from({ length: 12 }, (_, i) => ({ id: i, position: [(i % 4) * 4, 0, Math.floor(i / 4) * 4], rotation: i }));

/** A WebGPURenderer as the Forest sees it: the backend, `render` and `setRenderTarget` (mocks), other getters/setters no-ops. */
function fakeRenderer() {
  const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute: vi.fn(), render: vi.fn(), setRenderTarget: vi.fn() };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

/** A lod Forest drawn once on WebGPU, with its Impostors baked. */
async function baked(definition: TreeDefinitionInput) {
  const forest = createForest(definition, placements, { variants: 2, seed: 3, lod: { light: 10, impostor: 40 } });
  const renderer = fakeRenderer();
  forest.traverse((o) => {
    if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
  });
  await forest.lodReady;
  return { forest, renderer };
}

/** The atlas names of every bake's tree layer (one per Variant; the wood layer, `woodOutput` first, is left out). */
function atlases(renderer: ReturnType<typeof fakeRenderer>): string[][] {
  return renderer.setRenderTarget.mock.calls
    .filter(([t]) => t)
    .map(([t]) => (t as { textures: { name: string }[] }).textures.map((x) => x.name))
    .filter((names) => names[0] === 'output');
}

function cards(forest: Forest): MeshStandardNodeMaterial[] {
  return forest.children
    .filter((o): o is Mesh => o instanceof Mesh && !(o instanceof InstancedMesh) && o.name.startsWith('forest impostor'))
    .map((m) => m.material as MeshStandardNodeMaterial);
}

/** Every node reachable from `root` (through its node children). */
function nodesOf(root: Node | null): Set<unknown> {
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const child of (node as { getChildren?: () => Iterable<unknown> }).getChildren?.() ?? []) visit(child);
  };
  visit(root);
  return seen;
}

/** The float uniforms (by current value) a node graph reads. */
function uniformValues(root: Node | null): number[] {
  return [...nodesOf(root)].filter((n): n is { isUniformNode: true; value: number } => (n as { isUniformNode?: boolean }).isUniformNode === true && typeof (n as { value: unknown }).value === 'number').map((n) => n.value);
}

describe('Material Features on Impostors', () => {
  it('bake no extra atlas when no Material Feature is set', async () => {
    const { forest, renderer } = await baked(base);
    expect(atlases(renderer)).toEqual([['output', 'normal', 'season'], ['output', 'normal', 'season']]);
    for (const material of cards(forest)) {
      expect(material.aoNode).toBeNull();
      expect(Object.hasOwn(material, 'setupLightingModel')).toBe(false);
    }
    // Crown Normals at 0 count as off: nothing is baked for them either.
    expect(atlases((await baked(withMaterials({ leaf: { crownNormals: 0 } }))).renderer)).toEqual([['output', 'normal', 'season'], ['output', 'normal', 'season']]);
  });

  it.each([
    ['Crown Normals', { leaf: { crownNormals: 0.7 } }],
    ['Leaf Translucency', { leaf: { translucency } }],
    ['Structural Occlusion', { occlusion: { strength: 0.6 } }],
    ['all three', { leaf: { crownNormals: 0.7, translucency }, occlusion: { strength: 0.6 } }],
  ])('bake one features atlas when %s is set', async (_, materials) => {
    const { renderer } = await baked(withMaterials(materials));
    expect(atlases(renderer)).toEqual([['output', 'normal', 'season', 'features'], ['output', 'normal', 'season', 'features']]);
  });

  it('apply Crown Normals to the card normal, with the live amount', async () => {
    const { forest } = await baked(withMaterials({ leaf: { crownNormals: 0.7 } }));
    const plain = cards((await baked(base)).forest)[0]!;
    for (const material of cards(forest)) {
      expect(uniformValues(material.normalNode)).toContain(0.7);
      expect(uniformValues(plain.normalNode)).not.toContain(0.7);
      expect(material.aoNode).toBeNull();
    }
  });

  it('apply Leaf Translucency through the lighting model', async () => {
    const { forest } = await baked(withMaterials({ leaf: { translucency } }));
    for (const material of cards(forest)) {
      expect(Object.hasOwn(material, 'setupLightingModel')).toBe(true);
      const model = (material.setupLightingModel as () => { isLeafTranslucencyModel?: boolean })();
      expect(model.isLeafTranslucencyModel).toBe(true);
    }
  });

  it('apply Structural Occlusion as the card aoNode, with the live strength', async () => {
    const { forest } = await baked(withMaterials({ occlusion: { strength: 0.6 } }));
    for (const material of cards(forest)) expect(uniformValues(material.aoNode)).toContain(0.6);
  });

  it('follow the live Forest values without a rebake or a recompile', async () => {
    const { forest, renderer } = await baked(withMaterials({ leaf: { crownNormals: 0.7, translucency }, occlusion: { strength: 0.6 } }));
    const renders = renderer.render.mock.calls.length;
    const materials = cards(forest);
    const versions = materials.map((m) => m.version);
    forest.crownNormals = 0.2;
    forest.translucency = { strength: 0.9 };
    forest.occlusionStrength = 0.1;
    for (const material of materials) {
      expect(uniformValues(material.normalNode)).toContain(0.2);
      expect(uniformValues(material.aoNode)).toContain(0.1);
    }
    expect(renderer.render.mock.calls.length).toBe(renders);
    expect(materials.map((m) => m.version)).toEqual(versions);
  });
});
