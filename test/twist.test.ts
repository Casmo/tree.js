import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh } from 'three/webgpu';
import { bakeTree, createForest, createTree, DetailLevel, extendDefinition, type ForestPlacement, type TreeDefinition } from '../src/index';
import { generateLightTree, generateTree } from '../src/generator';
import lowPoly from '../src/styles/low-poly';
import realistic from '../src/styles/realistic';

/** A Style's broadleaf with Twist on the trunk and every branch level. */
const twisted = (definition: TreeDefinition, twist = 0.7, twists = 3) =>
  extendDefinition(definition, { trunk: { twist, twists }, branches: definition.branches.map((level) => ({ ...level, twist, twists })) });

describe('Twisted trees downstream', () => {
  it('grow, change with the Season and carry Wind attributes like any tree', () => {
    const definition = twisted(lowPoly.broadleaf);
    const data = generateTree(definition, 3);
    expect(data.growth.branches).toHaveLength(data.skeleton.branches.length);
    for (const name of Object.keys(data.wood.attributes)) {
      expect(data.wood.attributes[name]!.array.every(Number.isFinite), name).toBe(true);
    }
    const young = createTree(definition, { seed: 3, growth: 0.3, season: 0.6 });
    expect(young.growth).toBe(0.3);
    young.dispose();
  });

  it('keep their Twist on the Light Detail Level: twisted branches are swept with at least 3 Sections per turn', () => {
    const wood = (definition: TreeDefinition) => generateLightTree(definition, 3).wood.positions.length;
    // Low-poly branches have 1–2 Sections: halving them would straighten a Twist again.
    expect(wood(twisted(lowPoly.broadleaf))).toBeGreaterThan(wood(lowPoly.broadleaf) * 1.5);
  });

  it('keep a twisted trunk on the Light Detail Level: its Stems are swept with at least 3 Sections per turn', () => {
    const rings = (definition: TreeDefinition) => {
      const data = generateLightTree(extendDefinition(definition, { branches: [], leaves: { count: 0 } }), 3);
      return data.wood.positions.length;
    };
    const bare = extendDefinition(lowPoly.broadleaf, { trunk: { flare: 0 } });
    // Low-poly trunks have few Sections: halving them would straighten the trunk's Twist again.
    expect(rings(extendDefinition(bare, { trunk: { twist: 0.7, twists: 4 } }))).toBeGreaterThan(rings(bare) * 2);
  });

  it('bake into static meshes at any Growth', () => {
    const tree = createTree(twisted(realistic.broadleaf), { seed: 3 });
    for (const growth of [0.2, 1]) {
      const wood = bakeTree(tree, { growth }).getObjectByName('wood') as Mesh;
      const positions = wood.geometry.getAttribute('position').array;
      expect(positions.length).toBeGreaterThan(0);
      expect(Array.from(positions).every(Number.isFinite)).toBe(true);
    }
    tree.dispose();
  });

  it('draw far away as Impostors in a Forest: the bake renders them and the cards replace them', async () => {
    const definition = twisted(extendDefinition(lowPoly.broadleaf, { leaves: { count: 2 } }));
    const placements: ForestPlacement[] = Array.from({ length: 6 }, (_, i) => ({ id: i, position: [i * 4, 0, 0], rotation: i }));
    const forest = createForest(definition, placements, { variants: 2, seed: 3, lod: { light: 10, impostor: 40 } });
    // A WebGPURenderer as the Forest sees it: the backend, `render` and `setRenderTarget` (mocks), other getters/setters no-ops.
    const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute: vi.fn(), render: vi.fn(), setRenderTarget: vi.fn() };
    const renderer = new Proxy(target, {
      get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
    });
    forest.traverse((o) => {
      if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
    });
    await forest.lodReady;
    expect(target.render).toHaveBeenCalledTimes(4); // tree and wood layer per Variant
    expect(forest.lodUniforms!.farthest.value).toBe(DetailLevel.Impostor);
    for (const variant of forest.variants) {
      const cards = forest.children.filter((o) => o instanceof Mesh && !(o instanceof InstancedMesh) && o.name === `forest impostor ${variant.index}`);
      expect(cards).toHaveLength(1);
    }
    forest.dispose();
  });
});

/** A Style's broadleaf with Corkscrew branch levels (the trunk keeps its Twist settings). */
const corkscrewed = (definition: TreeDefinition, twist = 0.7, twists = 3) =>
  extendDefinition(definition, { branches: definition.branches.map((level, i) => ({ ...level, twist, twists, twistStyle: 'corkscrew' as const, twistCurve: 0.6, spin: i % 2 ? 'clockwise' as const : 'random' as const })) });

describe('Corkscrew trees downstream', () => {
  it('grow, change with the Season and carry Wind attributes like any tree', () => {
    const definition = corkscrewed(lowPoly.broadleaf);
    const data = generateTree(definition, 3);
    expect(data.growth.branches).toHaveLength(data.skeleton.branches.length);
    for (const name of Object.keys(data.wood.attributes)) {
      expect(data.wood.attributes[name]!.array.every(Number.isFinite), name).toBe(true);
    }
    for (const season of [0, 0.6]) {
      const tree = createTree(definition, { seed: 3, growth: 0.3, season });
      expect(tree.growth).toBe(0.3);
      tree.dispose();
    }
  });

  it('keep their Corkscrew on the Light Detail Level: branches are swept with 6 Sections per Twists, more than a Snake keeps', () => {
    const wood = (definition: TreeDefinition) => generateLightTree(definition, 3).wood.positions.length;
    const snake = wood(twisted(extendDefinition(lowPoly.broadleaf, { trunk: { twist: 0 } })));
    expect(wood(corkscrewed(lowPoly.broadleaf))).toBeGreaterThan(snake * 1.5);
  });

  it('roll their bark on the Light Detail Level as on the full tree (ADR 0016)', () => {
    const definition = corkscrewed(lowPoly.broadleaf);
    const rolls = (data: { skeleton: { branches: { path: string; roll?: number }[] } }) => data.skeleton.branches.map((b) => [b.path, b.roll]);
    const light = rolls(generateLightTree(definition, 3));
    const full = new Map(rolls(generateTree(definition, 3)) as [string, number | undefined][]);
    expect(light.filter(([, roll]) => roll).length).toBeGreaterThan(0);
    for (const [path, roll] of light) expect(roll, String(path)).toBe(full.get(path as string));
  });

  it('bake into static meshes at any Growth', () => {
    const tree = createTree(corkscrewed(realistic.broadleaf), { seed: 3 });
    for (const growth of [0.2, 1]) {
      const wood = bakeTree(tree, { growth }).getObjectByName('wood') as Mesh;
      const positions = wood.geometry.getAttribute('position').array;
      expect(positions.length).toBeGreaterThan(0);
      expect(Array.from(positions).every(Number.isFinite)).toBe(true);
    }
    tree.dispose();
  });

  it('draw far away as Impostors in a Forest', async () => {
    const definition = corkscrewed(extendDefinition(lowPoly.broadleaf, { leaves: { count: 2 } }));
    const placements: ForestPlacement[] = Array.from({ length: 6 }, (_, i) => ({ id: i, position: [i * 4, 0, 0], rotation: i }));
    const forest = createForest(definition, placements, { variants: 2, seed: 3, lod: { light: 10, impostor: 40 } });
    const target = { isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute: vi.fn(), render: vi.fn(), setRenderTarget: vi.fn() };
    const renderer = new Proxy(target, {
      get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
    });
    forest.traverse((o) => {
      if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
    });
    await forest.lodReady;
    expect(target.render).toHaveBeenCalledTimes(4);
    expect(forest.lodUniforms!.farthest.value).toBe(DetailLevel.Impostor);
    forest.dispose();
  });
});
