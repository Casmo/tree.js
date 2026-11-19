import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { sceneWind, Wind as WindObject, type Forest as ForestObject, type ForestTree, type Vec3 } from '../../src/index';
import { Forest } from '../../src/react';
import { trunkHeight } from '../../src/generator';
import { PerspectiveCamera } from 'three/webgpu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;

/** A stand-in WebGPURenderer: the test renderer's default is the classic WebGLRenderer, which tree.js refuses (ADR 0002). */
const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;

const definition = { schemaVersion: 2, branches: [{ count: 2 }], leaves: { count: 2 } };

let renderer: Renderer | undefined;
afterEach(async () => {
  await renderer?.unmount();
  renderer = undefined;
});

/** The tree.js Forest object currently in the scene. */
function sceneForest(r: Renderer): ForestObject {
  const forests = r.scene.children.map((c) => c.instance).filter((o) => (o as Partial<ForestObject>).isForest);
  expect(forests).toHaveLength(1);
  return forests[0] as ForestObject;
}

describe('<Forest> (React Three Fiber)', () => {
  it('puts a forest with the placed trees in the scene', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }, { id: 'b', position: [3, 0, 0] as Vec3 }];
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={definition} variants={2} seed={5} placements={placements} />,
      { gl },
    );
    const forest = sceneForest(renderer);
    expect(forest.seed).toBe(5);
    expect(forest.variants).toHaveLength(2);
    expect(forest.trees.map((t) => t.key)).toEqual(['a', 'b']);
    expect(forest.get('b')!.placement.position).toEqual([3, 0, 0]);
  });

  it('changing placements plants and cuts only the affected trees', async () => {
    const a = { id: 'a', position: [0, 0, 0] as Vec3 };
    const b = { id: 'b', position: [3, 0, 0] as Vec3 };
    const c = { id: 'c', position: [6, 0, 0] as Vec3 };
    renderer = await ReactThreeTestRenderer.create(<Forest definition={definition} placements={[a, b, c]} growth={0.6} />, { gl });
    const forest = sceneForest(renderer);
    const [treeA, treeB, treeC] = forest.trees as ForestTree[];
    const stateA = forest.instanceState(treeA!);
    const stateC = forest.instanceState(treeC!);
    const writes = watchWrites([treeA!, treeC!]);

    // Cut b, plant d; a new array of new (equal) placement objects for a and c.
    const d = { id: 'd', position: [9, 0, 0] as Vec3 };
    await renderer.update(<Forest definition={definition} placements={[{ ...a }, { ...c }, d]} growth={0.6} />);
    expect(sceneForest(renderer)).toBe(forest);
    expect(forest.trees.map((t) => t.key)).toEqual(['a', 'c', 'd']);
    expect(forest.get('a')).toBe(treeA);
    expect(forest.get('c')).toBe(treeC);
    expect(forest.get('b')).toBeUndefined();
    expect(treeB!.slot).toBe(-1);
    expect(forest.instanceState('a')).toEqual(stateA);
    expect(forest.instanceState('c')).toEqual(stateC);
    expect(forest.get('d')!.growth).toBeCloseTo(0.6);
    expect(writes()).toBe(0);
  });

  it('moving a tree (same id, new position) re-plants only that tree', async () => {
    const a = { id: 'a', position: [0, 0, 0] as Vec3 };
    const b = { id: 'b', position: [3, 0, 0] as Vec3 };
    renderer = await ReactThreeTestRenderer.create(<Forest definition={definition} placements={[a, b]} />, { gl });
    const forest = sceneForest(renderer);
    const treeA = forest.get('a')!;
    const treeB = forest.get('b')!;

    await renderer.update(<Forest definition={definition} placements={[a, { ...b, position: [4, 0, 1], scale: 2 }]} />);
    expect(forest.get('a')).toBe(treeA);
    const moved = forest.get('b')!;
    expect(moved).not.toBe(treeB);
    expect(moved.placement).toMatchObject({ position: [4, 0, 1], scale: 2 });
    // Its look comes from the id, so it stays the same tree.
    expect(moved.variant).toBe(treeB.variant);
  });

  it('per-tree Growth/Season override the forest values; changing them only updates that tree', async () => {
    const a = { id: 'a', position: [0, 0, 0] as Vec3 };
    const b = { id: 'b', position: [3, 0, 0] as Vec3 };
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={definition} placements={[a, { ...b, growth: 0.3, season: 0.8 }]} growth={0.9} season={0.2} />,
      { gl },
    );
    const forest = sceneForest(renderer);
    expect([forest.get('a')!.growth, forest.get('a')!.season]).toEqual([0.9, 0.2]);
    expect([forest.get('b')!.growth, forest.get('b')!.season]).toEqual([0.3, 0.8]);

    const writes = watchWrites([forest.get('a')!]);
    await renderer.update(
      <Forest definition={definition} placements={[a, { ...b, growth: 0.5, season: 0.8 }]} growth={0.9} season={0.2} />,
    );
    expect(forest.get('b')!.growth).toBe(0.5);
    expect(writes()).toBe(0);

    // The forest Growth reaches every tree without its own.
    await renderer.update(
      <Forest definition={definition} placements={[a, { ...b, growth: 0.5, season: 0.8 }]} growth={0.4} season={0.2} />,
    );
    expect(sceneForest(renderer)).toBe(forest);
    expect(forest.get('a')!.growth).toBe(0.4);
    expect(forest.get('b')!.growth).toBe(0.5);
  });

  it('a new forest seed or Variant count rebuilds the forest and disposes of the old one', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }];
    renderer = await ReactThreeTestRenderer.create(<Forest definition={definition} variants={2} placements={placements} />, { gl });
    const before = sceneForest(renderer);
    let disposals = 0;
    before.addEventListener('dispose', () => disposals++);

    await renderer.update(<Forest definition={definition} variants={3} placements={placements} />);
    const after = sceneForest(renderer);
    expect(after).not.toBe(before);
    expect(after.variants).toHaveLength(3);
    expect(after.trees.map((t) => t.key)).toEqual(['a']);
    expect(disposals).toBe(1);

    await renderer.update(<Forest definition={definition} variants={3} seed={9} placements={placements} />);
    expect(sceneForest(renderer).seed).toBe(9);
  });

  it('changing the wind only rebinds the same forest to the new Wind', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }];
    const gusts = new WindObject({ strength: 1 });
    renderer = await ReactThreeTestRenderer.create(<Forest definition={definition} variants={1} placements={placements} />, { gl });
    const before = sceneForest(renderer);
    expect(before.wind).toBe(sceneWind);

    await renderer.update(<Forest definition={definition} variants={1} placements={placements} wind={gusts} />);
    expect(sceneForest(renderer)).toBe(before);
    expect(before.wind).toBe(gusts);

    await renderer.update(<Forest definition={definition} variants={1} placements={placements} />);
    expect(sceneForest(renderer)).toBe(before);
    expect(before.wind).toBe(sceneWind);
  });

  it('unmounting disposes of the forest', async () => {
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={definition} placements={[{ position: [0, 0, 0] }, { position: [2, 0, 0] }]} />,
      { gl },
    );
    const forest = sceneForest(renderer);
    const counts = { forest: 0, geometries: 0, materials: 0 };
    forest.addEventListener('dispose', () => counts.forest++);
    for (const variant of forest.variants) {
      for (const mesh of [variant.wood, variant.leaves]) {
        mesh.geometry.addEventListener('dispose', () => counts.geometries++);
        mesh.material.addEventListener('dispose', () => counts.materials++);
      }
    }
    await renderer.unmount();
    renderer = undefined;
    expect(counts).toEqual({ forest: 1, geometries: 8, materials: 8 });
    expect(forest.parent).toBeNull();
    expect(forest.size).toBe(0);
  });

  it('passes castShadow/receiveShadow to the Variant meshes and transform props to the object', async () => {
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={definition} variants={1} placements={[]} receiveShadow={false} position={[1, 0, 2]} name="woods" />,
      { gl },
    );
    const forest = sceneForest(renderer);
    const variant = forest.variants[0]!;
    expect([variant.wood.castShadow, variant.wood.receiveShadow, variant.leaves.receiveShadow]).toEqual([true, false, false]);
    expect(forest.position.toArray()).toEqual([1, 0, 2]);
    expect(forest.name).toBe('woods');

    // Enough trees that the Variant meshes are replaced by bigger ones: they keep the shadow settings.
    const many = Array.from({ length: 40 }, (_, i) => ({ position: [i * 2, 0, 0] as Vec3 }));
    await renderer.update(<Forest definition={definition} variants={1} placements={many} receiveShadow={false} position={[1, 0, 2]} />);
    expect(variant.wood.count).toBe(40);
    expect([variant.wood.castShadow, variant.wood.receiveShadow, variant.leaves.receiveShadow]).toEqual([true, false, false]);
  });

  it('renders Fruit on every tree with a third mesh per Variant, which follows the shadow props', async () => {
    const fruiting = { ...definition, schemaVersion: 3, fruit: { type: 'round' as const, count: 2 } };
    const placements = Array.from({ length: 40 }, (_, i) => ({ position: [i * 2, 0, 0] as Vec3 }));
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={fruiting} variants={1} placements={placements} castShadow={false} />,
      { gl },
    );
    const variant = sceneForest(renderer).variants[0]!;
    const fruit = variant.fruit!;
    expect(fruit.parent).toBe(sceneForest(renderer));
    expect(fruit.count).toBe(40);
    expect([fruit.castShadow, fruit.receiveShadow]).toEqual([false, true]);
  });

  it('passes `lod` to the forest; toggling it on or off rebuilds the forest', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }];
    renderer = await ReactThreeTestRenderer.create(<Forest definition={definition} variants={1} placements={placements} />, { gl });
    const plain = sceneForest(renderer);
    expect(plain.lod).toBeNull();
    let disposals = 0;
    plain.addEventListener('dispose', () => disposals++);

    await renderer.update(<Forest definition={definition} variants={1} placements={placements} lod={{ light: 30, impostor: 90, fade: 0.2 }} />);
    const withLod = sceneForest(renderer);
    expect(withLod).not.toBe(plain);
    expect(disposals).toBe(1);
    expect(withLod.lod).toMatchObject({ light: 30, impostor: 90, fade: 0.2, camera: null });
    expect(withLod.trees.map((t) => t.key)).toEqual(['a']);

    await renderer.update(<Forest definition={definition} variants={1} placements={placements} lod={false} />);
    const off = sceneForest(renderer);
    expect(off).not.toBe(withLod);
    expect(off.lod).toBeNull();
  });

  it('`lod={true}` uses the automatic distances', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }];
    renderer = await ReactThreeTestRenderer.create(<Forest definition={definition} variants={2} placements={placements} lod />, { gl });
    const forest = sceneForest(renderer);
    const tallest = Math.max(...forest.variants.map((v) => trunkHeight(v.data.skeleton)));
    expect(forest.lod).toMatchObject({ light: tallest * 6, impostor: tallest * 20, fade: 0.1 });
  });

  it('changing lod distances, fade or camera writes `forest.lod` without a rebuild', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }];
    const camera = new PerspectiveCamera();
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={definition} variants={1} placements={placements} lod={{ light: 30, impostor: 90 }} />,
      { gl },
    );
    const forest = sceneForest(renderer);
    const uniforms = forest.lodUniforms!;
    let disposals = 0;
    forest.addEventListener('dispose', () => disposals++);

    await renderer.update(
      <Forest definition={definition} variants={1} placements={placements} lod={{ light: 40, impostor: 120, fade: 0.3, camera }} />,
    );
    expect(sceneForest(renderer)).toBe(forest);
    expect(forest.lod).toMatchObject({ light: 40, impostor: 120, fade: 0.3, camera });
    expect([uniforms.light.value, uniforms.impostor.value, uniforms.fade.value]).toEqual([40, 120, 0.3]);

    // Dropping fade and camera goes back to their defaults; `true` to the automatic distances.
    await renderer.update(<Forest definition={definition} variants={1} placements={placements} lod />);
    expect(sceneForest(renderer)).toBe(forest);
    const tallest = trunkHeight(forest.variants[0]!.data.skeleton);
    expect(forest.lod).toMatchObject({ light: tallest * 6, impostor: tallest * 20, fade: 0.1, camera: null });
    expect(disposals).toBe(0);
  });

  it('re-rendering with an equal lod object writes nothing', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }];
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={definition} variants={1} placements={placements} lod={{ light: 30, impostor: 90 }} />,
      { gl },
    );
    const forest = sceneForest(renderer);
    let writes = 0;
    const real = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(forest), 'lod')!;
    Object.defineProperty(forest, 'lod', {
      get: () => real.get!.call(forest),
      set: (v) => {
        writes++;
        real.set!.call(forest, v);
      },
    });
    await renderer.update(<Forest definition={definition} variants={1} placements={placements} lod={{ light: 30, impostor: 90 }} />);
    expect(sceneForest(renderer)).toBe(forest);
    expect(writes).toBe(0);
  });

  it('a new impostorAtlas or lightDefinition rebuilds the forest', async () => {
    const placements = [{ id: 'a', position: [0, 0, 0] as Vec3 }];
    renderer = await ReactThreeTestRenderer.create(
      <Forest definition={definition} variants={1} placements={placements} lod={{ light: 30, impostor: 90 }} />,
      { gl },
    );
    const before = sceneForest(renderer);

    await renderer.update(
      <Forest definition={definition} variants={1} placements={placements} lod={{ light: 30, impostor: 90, impostorAtlas: { size: 1024 } }} />,
    );
    const atlas = sceneForest(renderer);
    expect(atlas).not.toBe(before);
    expect(atlas.lod!.impostorAtlas).toEqual({ frames: 12, size: 1024 });

    await renderer.update(
      <Forest
        definition={definition}
        variants={1}
        placements={placements}
        lod={{ light: 30, impostor: 90, impostorAtlas: { size: 1024 }, lightDefinition: { leaves: { count: 1 } } }}
      />,
    );
    expect(sceneForest(renderer)).not.toBe(atlas);
    expect(sceneForest(renderer).lod!.lightDefinition).toEqual({ leaves: { count: 1 } });
  });

  it('grows a Form of a Style', async () => {
    const { default: lowPoly } = await import('../../src/styles/low-poly');
    renderer = await ReactThreeTestRenderer.create(
      <Forest style={lowPoly} form="conifer" variants={1} placements={[{ position: [0, 0, 0] }]} />,
      { gl },
    );
    expect(sceneForest(renderer).definition.name).toBe(lowPoly.conifer.name);
  });
});

/** Counts how often these trees' Growth or Season is written (each write rewrites their instance data). */
function watchWrites(trees: ForestTree[]): () => number {
  let count = 0;
  for (const tree of trees) {
    for (const prop of ['growth', 'season'] as const) {
      const real = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(tree), prop)!;
      Object.defineProperty(tree, prop, {
        get: () => real.get!.call(tree),
        set: (v: number) => {
          count++;
          real.set!.call(tree, v);
        },
      });
    }
  }
  return () => count;
}
