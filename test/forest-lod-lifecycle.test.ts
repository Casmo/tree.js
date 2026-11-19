// Detail Levels through the Forest lifecycle (ADR 0010): add, remove, capacity growth and dispose on
// a Forest that draws by Detail Level. The GPU tree data is checked per tree, by key: wherever a tree's
// slot ends up, it must hold exactly what a Forest built with the same trees from the start holds.
import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, InstancedMesh, Mesh, PerspectiveCamera, type EventDispatcher } from 'three/webgpu';
import { createForest, type Forest, type ForestPlacement, type ForestTree, type TreeDefinitionInput } from '../src/index';
import type { VariantLevels } from '../src/forest/levels';

const definition: TreeDefinitionInput = {
  schemaVersion: 3,
  trunk: { length: 5, lengthVariation: 0, bend: 0 },
  branches: [{ count: 3 }],
  leaves: { count: 2 },
  fruit: { type: 'round', count: 2, size: 0.15 },
  materials: { leaf: { crownNormals: 0.5 }, occlusion: { strength: 0.5 } },
};
const placements: ForestPlacement[] = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  position: [(i % 6) * 4, 0, Math.floor(i / 6) * 4],
  rotation: i,
  scale: 1 + (i % 3) / 4,
}));
const options = { variants: 3, seed: 5, lod: { light: 10, impostor: 40 } } as const;

/**
 * A WebGPURenderer as the Forest sees it on its first frame: the backend, and `render` plus no-op
 * getters/setters for the Impostor bake (which saves and restores the renderer's state).
 */
function bakingRenderer() {
  const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, render: vi.fn() };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

/** Draws every instanced mesh once on WebGPU (finds the backend), then waits for the Detail Levels and the Impostor bake. */
async function drawing(forest: Forest): Promise<Forest> {
  const renderer = bakingRenderer();
  forest.traverse((o) => {
    if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
  });
  await forest.lodReady;
  expect(forest.lodActive).toBe(true);
  return forest;
}

const lodForest = (trees: readonly ForestPlacement[] = placements) => drawing(createForest(definition, trees, options));

function levelsOf(forest: Forest, tree: ForestTree): VariantLevels {
  return forest.variants[tree.variant]!.levels!;
}

/** What the GPU draws a tree with: its 12 floats of tree data (rotation, state, position) at its slot. */
function gpuTree(forest: Forest, tree: ForestTree): number[] {
  const array = levelsOf(forest, tree).buffers.trees.array as Float32Array;
  return [...array.subarray(tree.slot * 12, (tree.slot + 1) * 12)];
}

/** Every tree's GPU data by key, and every Variant's tree count on the GPU. */
function gpuForest(forest: Forest) {
  return {
    trees: Object.fromEntries(forest.trees.map((t) => [t.key, gpuTree(forest, t)])),
    counts: forest.variants.map((v) => v.levels!.count),
  };
}

/** The forest as it would be had it been planted with `trees` from the start. */
async function plantedWith(trees: readonly ForestPlacement[]) {
  return gpuForest(await lodForest(trees));
}

/** Counts the 'dispose' events of `target` (a counter, not a mock: a failure must not print the target). */
function disposals(target: EventDispatcher<{ dispose: object }>): () => number {
  let count = 0;
  target.addEventListener('dispose', () => count++);
  return () => count;
}

const levelMeshes = (forest: Forest) => forest.children.filter((o): o is Mesh => o instanceof Mesh && !(o instanceof InstancedMesh));

describe('Detail Levels through the Forest lifecycle', () => {
  it('mirrors every tree into the GPU tree data at its slot, with each Variant\'s tree count', async () => {
    const forest = await lodForest();
    for (const tree of forest.trees) {
      const state = forest.instanceState(tree);
      const [, , , , scale, growth, season, windPhase, x, y, z] = gpuTree(forest, tree);
      expect([growth, season, windPhase]).toEqual([state.growth, state.season, state.windPhase].map(Math.fround));
      expect(scale).toBe(Math.fround(tree.placement.scale ?? 1));
      expect([x, y, z]).toEqual((tree.placement.position as number[]).map(Math.fround));
    }
    expect(forest.variants.map((v) => v.levels!.count)).toEqual(forest.variants.map((v) => v.trees.length));
  });

  it('adding and removing trees keeps every other tree as it was', async () => {
    const forest = await lodForest();
    const before = gpuForest(forest);
    // Swap-removes from the middle and the end of Variants, then plants new trees into the freed slots.
    for (const id of [0, 7, 12, 29, 3]) expect(forest.removeTree(id)).toBe(true);
    const planted: ForestPlacement[] = [
      { id: 'a', position: [50, 0, 50], scale: 1.5 },
      { id: 'b', position: [-20, 0, 8], rotation: 2 },
      { id: 'c', position: [3, 0, -30] },
    ];
    for (const placement of planted) forest.addTree(placement);
    forest.removeTree('b');

    const after = gpuForest(forest);
    for (const [key, data] of Object.entries(after.trees)) if (key in before.trees) expect(data).toEqual(before.trees[key]);
    const kept = [...placements.filter((p) => ![0, 7, 12, 29, 3].includes(p.id as number)), planted[0]!, planted[2]!];
    expect(after).toEqual(await plantedWith(kept));
  });

  it('selects the levels again after a tree is added or removed', async () => {
    const forest = await lodForest();
    const renderer = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 3 }, compute: vi.fn() };
    const camera = new PerspectiveCamera();
    const draw = () => {
      for (const mesh of levelMeshes(forest)) (mesh.onBeforeRender as (...args: unknown[]) => void)(renderer, {}, camera, mesh.geometry, mesh.material, null);
    };
    draw();
    forest.removeTree(4);
    draw();
    // Removing the last tree of a Variant rewrites nothing, but its count changes.
    const variant = forest.variants[0]!;
    forest.removeTree(variant.trees[variant.trees.length - 1]!);
    draw();
    expect(renderer.compute).toHaveBeenCalledTimes(3);
  });

  it('carries the Detail Level data over when a Variant outgrows its capacity', async () => {
    const forest = await lodForest();
    const variant = forest.variants[0]!;
    const levels = variant.levels!;
    const old = levels.buffers;
    const freed = { trees: disposals(old.trees), lists: disposals(old.lists), dithers: disposals(old.dithers), counters: disposals(old.counters), args: disposals(old.args) };
    const oldDispatches = [...levels.dispatches];
    const dispatchesFreed = oldDispatches.map(disposals);
    const meshes = levelMeshes(forest);
    const before = gpuForest(forest);
    const capacity = variant.capacity;

    const planted: ForestPlacement[] = [];
    for (let i = 0; variant.trees.length <= capacity * 2; i++) {
      const placement: ForestPlacement = { id: `planted ${i}`, position: [i * 0.5, 0, 100 + (i % 7)], scale: 1 + (i % 4) / 8 };
      planted.push(placement);
      forest.addTree(placement);
    }
    expect(variant.capacity).toBe(capacity * 4); // grown twice

    // The same Detail Level meshes and levels object, with room for every tree.
    expect(variant.levels).toBe(levels);
    expect(levelMeshes(forest)).toEqual(meshes);
    expect(levels.capacity).toBe(variant.capacity);
    expect(levels.buffers.trees.count).toBe(variant.capacity * 3);
    expect(levels.buffers.lists.count).toBe(variant.capacity * 3);
    expect(levels.buffers.dithers.count).toBe(variant.capacity * 3);
    // Every tree planted before (and after) the growth is still there, as if planted at once.
    const after = gpuForest(forest);
    for (const [key, data] of Object.entries(before.trees)) expect(after.trees[key]).toEqual(data);
    expect(after).toEqual(await plantedWith([...placements, ...planted]));

    // The outgrown per-tree buffers and compute pass are freed; the counters and the draw arguments
    // (which hold the GPU's counts) are kept.
    expect([freed.trees(), freed.lists(), freed.dithers()]).toEqual([1, 1, 1]);
    expect(dispatchesFreed.map((n) => n())).toEqual(oldDispatches.map(() => 1));
    expect(levels.dispatches.some((d) => oldDispatches.includes(d))).toBe(false);
    expect(levels.buffers.counters).toBe(old.counters);
    expect(levels.buffers.args).toBe(old.args);
    expect([freed.counters(), freed.args()]).toEqual([0, 0]);
    // The new instanced meshes stay hidden: the Detail Level meshes draw.
    expect(variant.meshes.every((m) => !m.visible && m.parent === forest && m.instanceMatrix.count === variant.capacity)).toBe(true);
  });

  it('keeps planting many trees at runtime, then cutting them all again, consistent', async () => {
    const forest = await lodForest();
    const start = gpuForest(forest);
    const ids: string[] = [];
    for (let i = 0; i < 500; i++) {
      ids.push(`p${i}`);
      forest.addTree({ id: `p${i}`, position: [(i % 25) * 2, 0, 60 + Math.floor(i / 25) * 2] });
      if (i % 3 === 0 && ids.length > 1) forest.removeTree(ids.splice(ids.length - 2, 1)[0]!);
    }
    for (const variant of forest.variants) {
      expect(variant.levels!.capacity).toBe(variant.capacity);
      expect(variant.levels!.count).toBe(variant.trees.length);
      variant.trees.forEach((tree, slot) => expect(tree.slot).toBe(slot));
    }
    for (const id of ids) forest.removeTree(id);
    // Back to the trees it started with: same data by key, same counts.
    expect(gpuForest(forest)).toEqual(start);
  });

  it('dispose() frees the Light and Full level geometry, the Impostor atlases, the compute pass and every GPU buffer', async () => {
    const forest = await lodForest();
    // Grow one Variant first: dispose must free the buffers in use, not only the first ones.
    const variant = forest.variants[1]!;
    const capacity = variant.capacity;
    for (let i = 0; variant.trees.length <= capacity; i++) forest.addTree({ id: `extra ${i}`, position: [i, 0, -50] });

    const meshes = levelMeshes(forest);
    expect(meshes.some((m) => m.name.endsWith(' light'))).toBe(true);
    const geometries = meshes.map((m) => disposals(m.geometry));
    const buffers = forest.variants.flatMap((v) => Object.values(v.levels!.buffers).map(disposals));
    const dispatches = forest.variants.flatMap((v) => v.levels!.dispatches.map(disposals));
    const instanced = forest.variants.flatMap((v) => v.meshes.map((m) => disposals(m.geometry)));
    const impostors = forest.variants.map((v) => v.impostor!);
    // The atlases are the attachments of one render target per Variant: disposing it frees them all.
    const atlases = impostors.map((i) => disposals(i.atlases.textures.output!.renderTarget as EventDispatcher<{ dispose: object }>));
    const cards = impostors.flatMap((i) => [disposals(i.part.geometry), disposals(i.part.material)]);
    const allGeometries = vi.spyOn(BufferGeometry.prototype, 'dispose');
    try {
      forest.dispose();
      for (const counts of [geometries, buffers, dispatches, instanced, atlases, cards]) expect(counts.map((n) => n())).toEqual(counts.map(() => 1));
      expect(forest.variants.every((v) => v.impostor === null)).toBe(true);
      expect(meshes.every((m) => m.parent === null)).toBe(true);
      expect(forest.variants.every((v) => v.levels === null)).toBe(true);
      // Light vertex data (3 parts per Variant) is freed besides the level meshes and the Variant's own.
      const variantGeometries = forest.variants.length * (3 /* Full sources */ + 3 /* Light sources */ + 3 /* instanced */ + 1 /* Impostor card */);
      expect(allGeometries.mock.calls.length).toBe(meshes.length + variantGeometries);
    } finally {
      allGeometries.mockRestore();
    }
  });

  it('dispose() before the Detail Levels are drawn builds nothing, and frees what is there', async () => {
    const forest = createForest(definition, placements, options);
    const renderer = { isWebGPURenderer: true, backend: { isWebGPUBackend: true } };
    for (const mesh of forest.variants.flatMap((v) => v.meshes)) (mesh.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, mesh.geometry, mesh.material, null);
    forest.dispose(); // before the microtask that builds the Detail Levels
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(forest.variants.every((v) => v.levels === null)).toBe(true);
    expect(levelMeshes(forest)).toEqual([]);
  });
});
