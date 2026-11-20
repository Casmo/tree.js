// Painterly (#112) next to features drawn for it in their own tickets: Snow Cover and Wetness (#117, painted
// branches; their look is checked in e2e/snow-cover.spec.ts and e2e/wetness.spec.ts), Impostors (#119; the
// Bake #120 is in test/bake.test.ts). Until then they fall back to another Style's look, but never throw.
import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, type MeshStandardNodeMaterial } from 'three/webgpu';
import { createForest, createTree, type ForestPlacement } from '../../src/index';
import { snowCoverHooks, wetnessHooks } from '../../src/weather';
import painterly from '../../src/styles/painterly';

const { broadleaf } = painterly;

/** A WebGPURenderer as the Forest sees it: the backend, `render` and `setRenderTarget` (mocks), other getters/setters no-ops. */
function fakeRenderer() {
  const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute: vi.fn(), render: vi.fn(), setRenderTarget: vi.fn() };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
  });
}

describe('painterly trees with features not yet painted', () => {
  it('take Snow Cover and Wetness hooks', () => {
    const tree = createTree(broadleaf, { seed: 1 });
    expect(() => (tree.shaderHooks = snowCoverHooks())).not.toThrow();
    expect(() => (tree.shaderHooks = wetnessHooks())).not.toThrow();
    tree.dispose();
  });

  it('get Impostors in a Forest, drawn with the painted shading', async () => {
    const placements: ForestPlacement[] = Array.from({ length: 6 }, (_, i) => ({ id: i, position: [i * 4, 0, 0], rotation: i }));
    const forest = createForest(broadleaf, placements, { variants: 2, seed: 3, lod: { light: 10, impostor: 40 } });
    const renderer = fakeRenderer();
    forest.traverse((o) => {
      if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
    });
    await forest.lodReady;
    const cards = forest.children.filter((o): o is Mesh => o instanceof Mesh && !(o instanceof InstancedMesh) && o.name.startsWith('forest impostor'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.material as MeshStandardNodeMaterial).toMatchObject({ isPaintedMaterial: true });
  });
});
