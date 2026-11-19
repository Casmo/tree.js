// Wetness (#101, ADR 0012): a ready-made Tree Shader Hook that darkens trees and gives them a sheen, driven
// by a scene-wide amount shared like `sceneWind`, opt-in from `@casmo/tree.js/weather`.
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { InstancedMesh, Mesh, type MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { createForest, createTree, setSceneShaderHooks, stackShaderHooks, type TreeShaderHook } from '../src/index';
import { pear } from '../src/species';
import stylized from '../src/styles/stylized';
import { sceneWetness, Wetness, wetnessHooks } from '../src/weather';

afterEach(() => {
  sceneWetness.amount = 0;
  setSceneShaderHooks({});
});

describe('the Wetness amount', () => {
  it('is 0 (dry) unless set, scene-wide and per Wetness', () => {
    expect(sceneWetness.amount).toBe(0);
    expect(new Wetness().amount).toBe(0);
    expect(new Wetness({ amount: 0.4 }).amount).toBe(0.4);
    sceneWetness.set({ amount: 0.7 });
    expect(sceneWetness.amount).toBe(0.7);
    expect(sceneWetness.uniforms.amount.value).toBe(0.7);
  });

  it('rejects amounts outside 0..1', () => {
    for (const bad of [-0.1, 1.1, Number.NaN]) expect(() => (sceneWetness.amount = bad)).toThrow(RangeError);
  });
});

describe('the Wetness hooks', () => {
  it('shade bark, leaves and fruit, each returning a roughness (the sheen)', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    const roughness = () => [tree.wood, tree.leaves, tree.fruit].map((mesh) => (mesh.material as MeshStandardNodeMaterial).roughnessNode);
    const before = roughness();
    tree.shaderHooks = wetnessHooks();
    roughness().forEach((node, i) => expect(node).not.toBe(before[i]));
    tree.shaderHooks = {};
    expect(roughness()).toEqual(before);
    tree.dispose();
  });

  it('run before the app’s own hooks, whatever order they are stacked in', () => {
    const seen: Node[] = [];
    const app: TreeShaderHook = ({ color, roughness }) => {
      seen.push(roughness);
      return color;
    };
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: stackShaderHooks({ leaves: app }, wetnessHooks()) });
    // The app's hook got the roughness Wetness returned, so the material keeps it.
    expect(tree.leaves.material.roughnessNode).toBe(seen[0]);
    tree.dispose();
  });
});

describe('the Wetness settings', () => {
  it('start at the defaults and change live, without rebuilding a material', () => {
    const hooks = wetnessHooks({ darkening: 0.5 });
    expect(hooks.settings).toMatchObject({ slope: 110, softness: 60, darkening: 0.5, sheen: 0.6, strength: { bark: 1, leaves: 0.8, fruit: 0.5 } });
    expect(hooks.wetness).toBe(sceneWetness);
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: hooks });
    const versions = () => [tree.wood, tree.leaves, tree.fruit].map((mesh) => mesh.material.version);
    const before = versions();
    hooks.set({ color: '#808080', slope: 45, softness: 10, strength: { leaves: 0.2 }, darkening: 0.9, sheen: 0.1 });
    sceneWetness.amount = 1;
    expect(versions()).toEqual(before);
    expect(hooks.settings).toMatchObject({ slope: 45, softness: 10, darkening: 0.9, sheen: 0.1, strength: { bark: 1, leaves: 0.2, fruit: 0.5 } });
    expect(hooks.settings.color.getHexString()).toBe('808080');
    tree.dispose();
  });

  it('reject values out of range', () => {
    const hooks = wetnessHooks();
    expect(() => hooks.set({ darkening: 2 })).toThrow(RangeError);
    expect(() => hooks.set({ sheen: -1 })).toThrow(RangeError);
    expect(() => hooks.set({ strength: { bark: 1.5 } })).toThrow(RangeError);
    expect(() => hooks.set({ softness: -5 })).toThrow(RangeError);
    expect(() => hooks.set({ color: '#000000', slope: 10, sheen: 2 })).toThrow(RangeError);
    expect(hooks.settings).toMatchObject({ darkening: 0.4, sheen: 0.6, slope: 110 }); // a bad value changes nothing
    expect(hooks.settings.color.getHexString()).not.toBe('000000');
  });

  it('follow another Wetness when given one', () => {
    const indoors = new Wetness();
    expect(wetnessHooks({ wetness: indoors }).wetness).toBe(indoors);
  });
});

describe('Wetness on a Forest and as the scene-wide default', () => {
  it('reaches every Variant of a Forest, and Trees through setSceneShaderHooks', () => {
    const forest = createForest(stylized.apply(pear), [{ position: [0, 0, 0] }], { variants: 1 });
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    const before = [forest.variants[0]!.leafMaterial.roughnessNode, tree.leaves.material.roughnessNode];
    setSceneShaderHooks(wetnessHooks());
    expect(forest.variants[0]!.leafMaterial.roughnessNode).not.toBe(before[0]);
    expect(tree.leaves.material.roughnessNode).not.toBe(before[1]);
    forest.dispose();
    tree.dispose();
  });

  it('reaches the Impostor cards of a Forest with Detail Levels', async () => {
    const renderer = new Proxy({ isWebGPURenderer: true, backend: { isWebGPUBackend: true }, info: { frame: 1 }, compute() {}, render() {}, setRenderTarget() {} }, {
      get: (t, key) => (key in t ? t[key as keyof typeof t] : typeof key === 'string' && /^(get|set)[A-Z]/.test(key) ? () => undefined : undefined),
    });
    const placements = Array.from({ length: 6 }, (_, i) => ({ position: [i * 4, 0, 0] as [number, number, number] }));
    const forest = createForest(stylized.apply(pear), placements, { variants: 1, lod: { light: 10, impostor: 40 } });
    forest.traverse((o) => {
      if (o instanceof InstancedMesh) (o.onBeforeRender as (...args: unknown[]) => void)(renderer, null, null, o.geometry, o.material, null);
    });
    await forest.lodReady;
    const card = forest.children.find((o): o is Mesh => o instanceof Mesh && !(o instanceof InstancedMesh) && o.name.startsWith('forest impostor'))!;
    const material = card.material as MeshStandardNodeMaterial;
    const before = material.roughnessNode;
    forest.shaderHooks = wetnessHooks();
    expect(material.roughnessNode).not.toBe(before);
    forest.dispose();
  });
});

describe('Wetness packaging', () => {
  const root = new URL('../', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

  it('is published as its own entry, @casmo/tree.js/weather', () => {
    expect(JSON.parse(read('package.json')).exports['./weather']).toEqual({ types: './dist/weather/index.d.ts', import: './dist/weather.js' });
    expect(read('vite.config.ts')).toMatch(/weather: resolve\(import\.meta\.dirname, 'src\/weather\/index\.ts'\)/);
  });

  it('is imported by no other part of the library, so games without weather never load it', () => {
    const files = readdirSync(new URL('src/', root), { recursive: true, encoding: 'utf8' }).filter(
      (file) => /\.tsx?$/.test(file) && !file.startsWith('weather') && !file.endsWith('.test.ts'),
    );
    // Type-only imports are erased (`@casmo/tree.js/react` loads it with a dynamic import, on first use).
    const runtime = (source: string) => source.replace(/^import type [^;]*;/gm, '');
    for (const file of files) expect(runtime(read(`src/${file}`)), file).not.toMatch(/from '[./]*\/weather['/]/);
  });
});
