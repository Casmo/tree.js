// Tree Shader Hooks on Forests (#99, ADR 0010 / 0012): a hook set on a Forest reaches every Variant's
// materials (which draw the Full and Light Detail Levels too) and the Impostor cards, which apply it at
// draw time, so changing a hook never rebakes. With no hook nothing changes (ADR 0008).
import { describe, expect, it, vi } from 'vitest';
import { vec3 } from 'three/tsl';
import { InstancedMesh, Mesh, type MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { createForest, type Forest, type ForestPlacement, type TreeDefinitionInput, type TreeShaderHook } from '../src/index';

const definition: TreeDefinitionInput = {
  schemaVersion: 3,
  trunk: { length: 5, lengthVariation: 0, bend: 0 },
  branches: [{ count: 3 }],
  leaves: { count: 2 },
  fruit: { type: 'round' },
};
const placements: ForestPlacement[] = Array.from({ length: 12 }, (_, i) => ({ id: i, position: [(i % 4) * 4, 0, Math.floor(i / 4) * 4], rotation: i }));
const tint: TreeShaderHook = ({ color }) => color.mul(vec3(1, 0, 1));

/** A WebGPURenderer as the Forest sees it: the backend, `render` and `setRenderTarget` (mocks), other getters/setters no-ops. */
function fakeRenderer() {
  const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute: vi.fn(), render: vi.fn(), setRenderTarget: vi.fn() };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

/** Draws a lod Forest once on WebGPU and waits for its Impostors to be baked. */
async function drawBaked(forest: Forest) {
  const renderer = fakeRenderer();
  forest.traverse((o) => {
    if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
  });
  await forest.lodReady;
  return renderer;
}

const variantMaterials = (forest: Forest, part: 'bark' | 'leaves' | 'fruit') =>
  forest.variants.map((v) => ({ bark: v.barkMaterial, leaves: v.leafMaterial, fruit: v.fruitMaterial! })[part]);

function cards(forest: Forest): MeshStandardNodeMaterial[] {
  return forest.children
    .filter((o): o is Mesh => o instanceof Mesh && !(o instanceof InstancedMesh) && o.name.startsWith('forest impostor'))
    .map((m) => m.material as MeshStandardNodeMaterial);
}

const shading = (m: MeshStandardNodeMaterial) => ({ colorNode: m.colorNode, roughnessNode: m.roughnessNode, vertexColors: m.vertexColors, positionNode: m.positionNode });

describe('Tree Shader Hooks on a Forest', () => {
  it('start with none: no hooks, materials untouched', () => {
    const forest = createForest(definition, placements, { variants: 2 });
    expect(forest.shaderHooks).toEqual({});
    forest.dispose();
  });

  it.each(['bark', 'leaves', 'fruit'] as const)('set on %s change that part of every Variant, never the geometry', (part) => {
    const forest = createForest(definition, placements, { variants: 2 });
    const parts = ['bark', 'leaves', 'fruit'] as const;
    const before = Object.fromEntries(parts.map((p) => [p, variantMaterials(forest, p).map(shading)]));
    const geometries = forest.variants.flatMap((v) => v.meshes.map((m) => m.geometry));
    forest.shaderHooks = { [part]: tint };
    expect(forest.shaderHooks).toEqual({ [part]: tint });
    for (const p of parts) {
      const after = variantMaterials(forest, p).map(shading);
      if (p === part) after.forEach((s, i) => expect(s.colorNode).not.toBe(before[p]![i]!.colorNode));
      else expect(after).toEqual(before[p]);
    }
    expect(forest.variants.flatMap((v) => v.meshes.map((m) => m.geometry))).toEqual(geometries);

    forest.shaderHooks = {};
    for (const p of parts) expect(variantMaterials(forest, p).map(shading)).toEqual(before[p]);
    forest.dispose();
  });

  it('are given at creation as an option, and get the per-tree Season, Growth and position', () => {
    const hook = vi.fn<TreeShaderHook>(({ color }) => color);
    const forest = createForest(definition, placements, { variants: 2, shaderHooks: { leaves: hook } });
    expect(forest.shaderHooks).toEqual({ leaves: hook });
    expect(hook).toHaveBeenCalledTimes(2); // once per Variant
    for (const [input] of hook.mock.calls) {
      expect(input.part).toBe('leaves');
      for (const key of ['color', 'roughness', 'normal', 'position', 'treePosition', 'season', 'growth'] as const) {
        expect((input[key] as Node).isNode, key).toBe(true);
      }
    }
    forest.dispose();
  });

  it('reach the Impostor cards, set before or after the bake, without a rebake', async () => {
    const forest = createForest(definition, placements, { variants: 2, lod: { light: 10, impostor: 40 }, shaderHooks: { leaves: tint } });
    const renderer = await drawBaked(forest);
    const plain = createForest(definition, placements, { variants: 2, lod: { light: 10, impostor: 40 } });
    await drawBaked(plain);
    const [card] = cards(forest);
    const [plainCard] = cards(plain);
    expect(card!.colorNode).not.toBe(plainCard!.colorNode);

    const bakes = renderer.render.mock.calls.length;
    const before = shading(card!);
    forest.shaderHooks = { bark: tint };
    expect(card!.colorNode).not.toBe(before.colorNode);
    forest.shaderHooks = {};
    expect(renderer.render.mock.calls.length).toBe(bakes); // no rebake
    // Removed: the card's own nodes are back.
    const own = shading(card!);
    forest.shaderHooks = { leaves: tint };
    forest.shaderHooks = {};
    expect(shading(card!)).toEqual(own);
    for (const f of [forest, plain]) f.dispose();
  });

  it('on an Impostor run the bark hook and the leaves hook, each for its own texels', async () => {
    const bark = vi.fn<TreeShaderHook>(({ color }) => color);
    const leaves = vi.fn<TreeShaderHook>(({ color }) => color);
    const forest = createForest(definition, placements, { variants: 1, lod: { light: 10, impostor: 40 } });
    await drawBaked(forest);
    forest.shaderHooks = { bark, leaves, fruit: tint };
    // Variant materials and the card: one call each per part (the card has no Fruit).
    expect(bark.mock.calls.map(([i]) => i.part)).toEqual(['bark', 'bark']);
    expect(leaves.mock.calls.map(([i]) => i.part)).toEqual(['leaves', 'leaves']);
    forest.dispose();
  });
});
