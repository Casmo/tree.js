import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { sceneWind, Wind as WindObject, type Tree as TreeObject } from '../../src/index';
import { Tree } from '../../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;

/** A stand-in WebGPURenderer: the test renderer's default is the classic WebGLRenderer, which trees refuse (ADR 0002). */
const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;

const definition = { schemaVersion: 2, branches: [{ count: 2 }], leaves: { count: 2 } };

let renderer: Renderer | undefined;
afterEach(async () => {
  await renderer?.unmount();
  renderer = undefined;
});

/** The tree.js Tree object currently in the scene. */
function sceneTree(r: Renderer): TreeObject {
  const trees = r.scene.children.map((c) => c.instance).filter((o) => (o as Partial<TreeObject>).isTree);
  expect(trees).toHaveLength(1);
  return trees[0] as TreeObject;
}

describe('<Tree> (React Three Fiber)', () => {
  it('puts a generated tree in the scene', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} seed={3} />, { gl });
    const tree = sceneTree(renderer);
    expect(tree.seed).toBe(3);
    expect(tree.data.skeleton.branches.length).toBe(3);
  });

  it('changing growth or season only updates the same tree', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} seed={3} growth={0.2} season={0.1} />, { gl });
    const before = sceneTree(renderer);
    expect(before.growth).toBeCloseTo(0.2);
    expect(before.season).toBeCloseTo(0.1);

    await renderer.update(<Tree definition={{ ...definition }} seed={3} growth={0.7} season={0.6} />);
    const after = sceneTree(renderer);
    expect(after).toBe(before);
    expect(after.growth).toBeCloseTo(0.7);
    expect(after.season).toBeCloseTo(0.6);
  });

  it('changing the wind only rebinds the same tree to the new Wind', async () => {
    const gusts = new WindObject({ strength: 1 });
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} seed={3} />, { gl });
    const before = sceneTree(renderer);
    expect(before.wind).toBe(sceneWind);

    await renderer.update(<Tree definition={definition} seed={3} wind={gusts} />);
    expect(sceneTree(renderer)).toBe(before);
    expect(before.wind).toBe(gusts);

    await renderer.update(<Tree definition={definition} seed={3} />);
    expect(sceneTree(renderer)).toBe(before);
    expect(before.wind).toBe(sceneWind);
  });

  it('a new seed regenerates the tree and disposes of the old one', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} seed={3} />, { gl });
    const before = sceneTree(renderer);
    const disposals = watchDispose(before);

    await renderer.update(<Tree definition={definition} seed={4} />);
    const after = sceneTree(renderer);
    expect(after).not.toBe(before);
    expect(after.seed).toBe(4);
    expect(disposals()).toEqual({ tree: 1, geometries: 2, materials: 2 });
  });

  it('a different definition regenerates the tree', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} />, { gl });
    const before = sceneTree(renderer);
    await renderer.update(<Tree definition={{ ...definition, branches: [{ count: 4 }] }} />);
    const after = sceneTree(renderer);
    expect(after).not.toBe(before);
    expect(after.data.skeleton.branches.length).toBe(5);
  });

  it('unmounting disposes of the tree', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} />, { gl });
    const tree = sceneTree(renderer);
    const disposals = watchDispose(tree);
    await renderer.unmount();
    renderer = undefined;
    expect(disposals()).toEqual({ tree: 1, geometries: 2, materials: 2 });
    expect(tree.parent).toBeNull();
  });

  it('passes castShadow/receiveShadow to the meshes and transform props to the object', async () => {
    renderer = await ReactThreeTestRenderer.create(
      <Tree definition={definition} castShadow={false} position={[4, 0, -2]} scale={2} name="oak" />,
      { gl },
    );
    const tree = sceneTree(renderer);
    expect([tree.wood.castShadow, tree.leaves.castShadow]).toEqual([false, false]);
    expect([tree.wood.receiveShadow, tree.leaves.receiveShadow]).toEqual([true, true]);
    expect(tree.position.toArray()).toEqual([4, 0, -2]);
    expect(tree.scale.toArray()).toEqual([2, 2, 2]);
    expect(tree.name).toBe('oak');

    await renderer.update(<Tree definition={definition} position={[4, 0, -2]} scale={2} name="oak" />);
    expect(sceneTree(renderer)).toBe(tree);
    expect(tree.wood.castShadow).toBe(true);
  });

  it('renders Fruit, and passes the shadow props to the fruit mesh', async () => {
    const fruiting = { ...definition, schemaVersion: 3, fruit: { type: 'berry' as const, count: 3 } };
    renderer = await ReactThreeTestRenderer.create(<Tree definition={fruiting} castShadow={false} receiveShadow={false} />, { gl });
    const tree = sceneTree(renderer);
    expect(tree.children).toContain(tree.fruit);
    expect(tree.fruit.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect([tree.fruit.castShadow, tree.fruit.receiveShadow]).toEqual([false, false]);
    await renderer.update(<Tree definition={fruiting} />);
    expect([tree.fruit.castShadow, tree.fruit.receiveShadow]).toEqual([true, true]);
  });
});

/** Counts the 'dispose' events of a tree and of its meshes' geometries and materials. */
function watchDispose(tree: TreeObject): () => { tree: number; geometries: number; materials: number } {
  const counts = { tree: 0, geometries: 0, materials: 0 };
  tree.addEventListener('dispose', () => counts.tree++);
  for (const mesh of [tree.wood, tree.leaves]) {
    mesh.geometry.addEventListener('dispose', () => counts.geometries++);
    (mesh.material as import('three/webgpu').Material).addEventListener('dispose', () => counts.materials++);
  }
  return () => ({ ...counts });
}
