// Painterly in a Forest (#118, ADR 0010 / 0014): its Impostors bake the paint of the Leaf Masses and paint
// their leaf texels on the crown gradient, and a Painterly tree costs about what a stylized one does at the
// same Species and Detail Level. The look is checked in e2e/forest-lod.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, type Object3D } from 'three/webgpu';
import { createForest, loadStyle, withMaterialFeatures, type Forest, type ForestPlacement, type TreeDefinition } from '../../src/index';
import { generateLightTree, generateTree } from '../../src/generator';
import { PaintedNodeMaterial } from '../../src/materials';
import { loadSpecies, SPECIES_NAMES } from '../../src/species';

const painterly = await loadStyle('painterly');
const stylized = await loadStyle('stylized');
const placements: ForestPlacement[] = Array.from({ length: 6 }, (_, i) => ({ id: i, position: [i * 4, 0, 0], rotation: i }));

/** A WebGPURenderer as the Forest sees it: the backend, `render` and `setRenderTarget` (mocks), other getters/setters no-ops. */
function fakeRenderer() {
  const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute: vi.fn(), render: vi.fn(), setRenderTarget: vi.fn() };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

/** A lod Forest drawn once on WebGPU, with its Impostors baked. */
async function baked(definition: TreeDefinition) {
  const forest = createForest(definition, placements, { variants: 2, seed: 3, lod: { light: 10, impostor: 40 } });
  const renderer = fakeRenderer();
  forest.traverse((o) => {
    if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
  });
  await forest.lodReady;
  return { forest, renderer };
}

/** The atlas names of every bake pass of the first Variant (its render targets, in order). */
function passes(renderer: ReturnType<typeof fakeRenderer>): string[][] {
  const all = renderer.setRenderTarget.mock.calls.filter(([t]) => t).map(([t]) => (t as { textures: { name: string }[] }).textures.map((x) => x.name));
  return all.slice(0, all.length / 2);
}

const levelMeshes = (forest: Forest) => forest.children.filter((o): o is Mesh => o instanceof Mesh && !(o instanceof InstancedMesh));
const impostorCards = (forest: Forest) => levelMeshes(forest).filter((o) => o.name.startsWith('forest impostor'));

describe('painterly Impostors', () => {
  it('bake the paint of the Leaf Masses next to the colour, normal and Season atlases', async () => {
    const { renderer } = await baked(painterly.broadleaf);
    expect(passes(renderer)).toEqual([['output', 'normal', 'season', 'paint'], ['woodOutput', 'woodNormal']]);
  });

  it('bake in two passes of at most four atlases when Material Features are on too', async () => {
    const { renderer } = await baked(withMaterialFeatures(painterly.broadleaf, { crownNormals: 0.3, occlusion: { strength: 0.6 } }));
    expect(passes(renderer)).toEqual([['output', 'normal', 'season', 'features'], ['paint'], ['woodOutput', 'woodNormal']]);
  });

  it('paint their leaf texels on the crown gradient with the painted shading', async () => {
    const { forest } = await baked(painterly.conifer);
    const cards = impostorCards(forest);
    expect(cards.length).toBe(2);
    for (const card of cards) {
      const material = card.material as PaintedNodeMaterial;
      expect(material).toBeInstanceOf(PaintedNodeMaterial);
      expect(material.paint).toBeTypeOf('function');
      expect(material.paintAmount).not.toBeNull();
    }
  });

  it('of other Styles bake no paint atlas', async () => {
    const { renderer } = await baked(stylized.broadleaf);
    expect(passes(renderer).flat()).not.toContain('paint');
  });
});

describe('painterly in a Forest costs about what stylized does', () => {
  /** Triangles of one tree at the Full and the Light Detail Level. */
  const triangles = (definition: TreeDefinition) =>
    [generateTree(definition, 42), generateLightTree(definition, 42)].map((d) => (d.wood.indices.length + d.leaves.indices.length + d.fruit.indices.length) / 3);

  it.each(SPECIES_NAMES)('%s: triangles per tree at the Full and Light Detail Levels within 1.3x of stylized', async (id) => {
    const species = await loadSpecies(id);
    const [paintedFull, paintedLight] = triangles(painterly.apply(species));
    const [stylizedFull, stylizedLight] = triangles(stylized.apply(species));
    expect(paintedFull).toBeLessThanOrEqual(stylizedFull! * 1.3);
    expect(paintedLight).toBeLessThanOrEqual(stylizedLight! * 1.3);
  });

  it('draw calls: the same meshes per Detail Level as stylized (wood, leaves, Fruit; one Impostor card)', async () => {
    const species = await loadSpecies('apple');
    const meshes = async (definition: TreeDefinition) => {
      const { forest } = await baked(definition);
      const names = levelMeshes(forest).map((o: Object3D) => o.name);
      forest.dispose();
      return names;
    };
    const painted = await meshes(painterly.apply(species));
    expect(painted).toEqual(await meshes(stylized.apply(species)));
    expect(painted.filter((n) => n.startsWith('forest impostor'))).toHaveLength(2);
  });
});
