// The Fantasy Styles on Impostors (#142, ADR 0010 / 0017): an Enchanted tree's Inner Glow shows on its far
// Impostor as on its near tree (leaves strongest at the crown's edge, bark veins), pulsing in the tree's own
// Wind phase with the same strengths as the Variant's materials, so distant trees don't pop. Pixels are
// checked in e2e/forest-lod-fantasy.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, type MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { createForest, type Forest, type ForestPlacement, type TreeDefinitionInput } from '../src/index';

const base: TreeDefinitionInput = {
  schemaVersion: 3,
  trunk: { length: 5, lengthVariation: 0, bend: 0 },
  branches: [{ count: 3 }],
  leaves: { count: 2 },
};
const enchanted: TreeDefinitionInput = { ...base, materials: { shading: 'enchanted', innerGlow: { leaf: 1.5, veins: 0.5 } } };
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

/** The atlas names of every bake pass. */
function atlases(renderer: ReturnType<typeof fakeRenderer>): string[][] {
  return renderer.setRenderTarget.mock.calls.filter(([t]) => t).map(([t]) => (t as { textures: { name: string }[] }).textures.map((x) => x.name));
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

const uniforms = (root: Node | null) => [...nodesOf(root)].filter((n) => (n as { isUniformNode?: boolean }).isUniformNode === true);

describe('Inner Glow on Impostors', () => {
  it('bakes a glow atlas (crown edge, bark veins) into the tree and wood layers of an Enchanted tree only', async () => {
    expect(atlases((await baked(enchanted)).renderer)).toEqual([
      ['output', 'normal', 'season', 'glow'],
      ['woodOutput', 'woodNormal', 'woodGlow'],
      ['output', 'normal', 'season', 'glow'],
      ['woodOutput', 'woodNormal', 'woodGlow'],
    ]);
    // Another shading ignores the field: nothing more is baked.
    const realistic = { ...enchanted, materials: { ...enchanted.materials, shading: 'standard' as const } };
    expect(atlases((await baked(realistic)).renderer).flat()).not.toContain('glow');
    expect(atlases((await baked({ ...base, materials: { shading: 'whimsical' } })).renderer).flat()).not.toContain('glow');
  });

  it("gives the card the Inner Glow as its emissive, with the Variant's own strengths, pulsing with the Wind clock", async () => {
    const { forest } = await baked(enchanted);
    cards(forest).forEach((card, i) => {
      expect(card.emissiveNode).not.toBeNull();
      const own = uniforms(forest.variants[i]!.leafMaterial.emissiveNode as Node);
      const shared = uniforms(card.emissiveNode as Node).filter((u) => own.includes(u));
      // The leaf strength (1.5), and the Wind time the pulse follows (the Forest's binding of the scene Wind):
      // near and far trees glow and pulse alike, and tuning one tunes the other.
      expect(shared.map((u) => (u as { value: unknown }).value)).toEqual(expect.arrayContaining([1.5]));
      expect(shared.length).toBeGreaterThanOrEqual(2);
    });
    forest.dispose();
  });

  it('leaves cards of other shadings without an emissive', async () => {
    const { forest } = await baked({ ...base, materials: { shading: 'whimsical' } });
    for (const card of cards(forest)) expect(card.emissiveNode).toBeNull();
    forest.dispose();
  });
});
