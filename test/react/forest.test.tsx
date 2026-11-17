import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Forest as ForestObject, ForestTree, Vec3 } from '../../src/index';
import { Forest } from '../../src/react';

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
