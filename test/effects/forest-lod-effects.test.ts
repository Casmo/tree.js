// Tree Effects and interaction on a Forest that draws by Detail Level (ADR 0009, ADR 0010): every
// level's meshes write the tree mask and the Tree ID `block base + slot`, and raycasting, treeAt and
// instanceState stay on the Variant's instanced meshes.
import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, NodeUpdateType, PerspectiveCamera, Raycaster, Vector2, Vector4, type Material, type Node, type Object3D } from 'three/webgpu';
import { createForest, DetailLevel, type Forest, type ForestPlacement, type TreeDefinitionInput } from '../../src/index';
import { TREE_ID, TREE_MASK, treeFromId, treeIdMRT, treeIdOf, treeMaskMRT } from '../../src/effects';

const definition: TreeDefinitionInput = { schemaVersion: 2, branches: [{ count: 3 }], leaves: { count: 2 }, fruit: { type: 'round', count: 2, size: 0.15 } };
const placements: ForestPlacement[] = Array.from({ length: 20 }, (_, i) => ({ id: i, position: [(i % 5) * 4, 0, Math.floor(i / 5) * 4], rotation: i }));

/** A WebGPURenderer as the Forest sees it on its first frame (the Impostor bake saves and restores its state). */
function bakingRenderer() {
  const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, render: vi.fn(), compute: vi.fn() };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

/** A Forest drawing by Detail Level: drawn once on WebGPU, Detail Levels on and Impostors baked. */
async function lodForest(): Promise<Forest> {
  const forest = createForest(definition, placements, { variants: 2, seed: 3, lod: { light: 10, impostor: 40 } });
  const renderer = bakingRenderer();
  for (const mesh of forest.variants.flatMap((v) => v.meshes)) (mesh.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, mesh.geometry, mesh.material, null);
  await forest.lodReady;
  expect(forest.lodActive).toBe(true);
  return forest;
}

/** The per-object uniform of an MRT output: the value it takes when `object` is drawn with `material`. */
function perObject(output: Node, object: Object3D, material: Material): unknown {
  const seen = new Set<Node>();
  let value: unknown;
  const visit = (node: Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.updateType === NodeUpdateType.OBJECT && (node as { isUniformNode?: boolean }).isUniformNode) {
      node.update({ object, material } as never);
      value = (node as unknown as { value: unknown }).value;
    }
    for (const child of node.getChildren()) visit(child as Node);
  };
  visit(output);
  return value instanceof Vector4 ? value.toArray() : value;
}

/** Every mesh drawing a Detail Level of each Variant, with its level. */
function levelMeshes(forest: Forest): { variant: number; level: DetailLevel; mesh: Mesh }[] {
  return forest.variants.flatMap((v, variant) =>
    v.levels!.meshes.map((mesh) => ({ variant, mesh, level: mesh.name.includes('impostor') ? DetailLevel.Impostor : mesh.name.includes('light') ? DetailLevel.Light : DetailLevel.Full })),
  );
}

describe('Tree Effects on a Forest drawing by Detail Level', () => {
  it('writes the Variant block base on the meshes of every level, so the drawn ID is base + slot', async () => {
    const forest = await lodForest();
    const id = treeIdMRT().outputNodes[TREE_ID]!;
    const meshes = levelMeshes(forest);
    expect(new Set(meshes.map((m) => m.level))).toEqual(new Set([DetailLevel.Full, DetailLevel.Light, DetailLevel.Impostor]));
    for (const { variant, mesh } of meshes) {
      const tree = forest.variants[variant]!.trees[1]!;
      // The base a level mesh writes, plus the slot of the tree it draws, is the tree's ID.
      const base = perObject(id, mesh, mesh.material as Material) as number;
      expect(base, `${mesh.name} writes its block base`).toBe(treeIdOf(tree)! - tree.slot);
      expect(treeFromId(base + tree.slot)).toBe(tree);
    }
  });

  it('round-trips every tree through treeIdOf and treeFromId', async () => {
    const forest = await lodForest();
    const ids = forest.trees.map((t) => treeIdOf(t)!);
    expect(new Set(ids).size).toBe(forest.size);
    for (const [i, tree] of forest.trees.entries()) expect(treeFromId(ids[i]!)).toBe(tree);
  });

  it('marks every level mesh as tree pixels in the tree mask, and selects it with its Forest', async () => {
    const forest = await lodForest();
    const all = treeMaskMRT().outputNodes[TREE_MASK]!;
    const selected = treeMaskMRT([forest]).outputNodes[TREE_MASK]!;
    const others = treeMaskMRT([]).outputNodes[TREE_MASK]!;
    for (const { mesh } of levelMeshes(forest)) {
      const material = mesh.material as Material;
      expect((perObject(all, mesh, material) as number[])[0], `${mesh.name} is a tree`).toBe(1);
      expect((perObject(selected, mesh, material) as number[])[2], `${mesh.name} is selected with its Forest`).toBe(1);
      expect((perObject(others, mesh, material) as number[])[2], `${mesh.name} is not selected`).toBe(0);
    }
  });
});

describe('interaction on a Forest drawing by Detail Level', () => {
  it('raycasts the Variant instanced meshes (instanceId = slot), so treeAt resolves the tree hit', async () => {
    const forest = await lodForest();
    forest.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(50, 1, 0.1, 500);
    const tree = forest.get(7)!;
    const [x, , z] = placements[7]!.position as [number, number, number];
    camera.position.set(x, 2, z + 60);
    camera.lookAt(x, 2, z);
    camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    const hits = raycaster.intersectObject(forest, true);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.object).toBeInstanceOf(InstancedMesh);
    expect(forest.treeAt(hits[0]!)).toBeDefined();
    expect(hits.map((h) => forest.treeAt(h)?.key)).toContain(tree.key);
  });

  it('reports the same instanceState as a Forest without lod', async () => {
    const forest = await lodForest();
    const plain = createForest(definition, placements, { variants: 2, seed: 3 });
    for (const tree of forest.trees) expect(forest.instanceState(tree)).toEqual(plain.instanceState(tree.key));
  });
});
