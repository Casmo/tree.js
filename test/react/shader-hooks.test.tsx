import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { vec3 } from 'three/tsl';
import { getSceneShaderHooks, setSceneShaderHooks, type Forest as ForestObject, type Tree as TreeObject, type TreeShaderHook } from '../../src/index';
import { Forest, SceneShaderHooks, Tree } from '../../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;
const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;
const definition = { schemaVersion: 2, branches: [{ count: 2 }], leaves: { count: 2 } };

const pale: TreeShaderHook = ({ color }) => color.mul(1.2);
const dusk: TreeShaderHook = ({ color }) => color.mul(vec3(1, 0.85, 0.7));

let renderer: Renderer | undefined;
afterEach(async () => {
  await renderer?.unmount();
  renderer = undefined;
  setSceneShaderHooks({});
});

const found = <T,>(r: Renderer, key: 'isTree' | 'isForest'): T => r.scene.children.map((c) => c.instance).find((o) => (o as unknown as Record<string, unknown>)[key]) as T;

describe('<Tree shaderHooks> and <Forest shaderHooks>', () => {
  it('sets, changes and removes the hooks of the same tree', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} shaderHooks={{ leaves: pale }} />, { gl });
    const tree = found<TreeObject>(renderer, 'isTree');
    expect(tree.shaderHooks).toEqual({ leaves: pale });
    const leafColor = tree.leaves.material.colorNode;

    await renderer.update(<Tree definition={definition} shaderHooks={{ leaves: pale, bark: dusk }} />);
    expect(found<TreeObject>(renderer, 'isTree')).toBe(tree);
    expect(tree.shaderHooks).toEqual({ leaves: pale, bark: dusk });
    expect(tree.leaves.material.colorNode).toBe(leafColor); // an unchanged part is left alone

    await renderer.update(<Tree definition={definition} />);
    expect(tree.shaderHooks).toEqual({});
  });

  it('a tree without the prop is drawn as before', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} />, { gl });
    const tree = found<TreeObject>(renderer, 'isTree');
    expect(tree.shaderHooks).toEqual({});
    expect(tree.leaves.material.vertexColors).toBe(true);
  });

  it('a regenerated tree gets the hooks too', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} seed={1} shaderHooks={{ bark: dusk }} />, { gl });
    await renderer.update(<Tree definition={definition} seed={2} shaderHooks={{ bark: dusk }} />);
    const tree = found<TreeObject>(renderer, 'isTree');
    expect(tree.seed).toBe(2);
    expect(tree.shaderHooks).toEqual({ bark: dusk });
  });

  it('sets, changes and removes the hooks of every tree of a forest', async () => {
    const placements = [{ position: [0, 0, 0] as [number, number, number] }];
    renderer = await ReactThreeTestRenderer.create(<Forest definition={definition} placements={placements} shaderHooks={{ leaves: pale }} />, { gl });
    const forest = found<ForestObject>(renderer, 'isForest');
    expect(forest.shaderHooks).toEqual({ leaves: pale });
    await renderer.update(<Forest definition={definition} placements={placements} shaderHooks={{ leaves: null }} />);
    expect(forest.shaderHooks).toEqual({ leaves: null });
    await renderer.update(<Forest definition={definition} placements={placements} />);
    expect(forest.shaderHooks).toEqual({});
  });
});

describe('<SceneShaderHooks>', () => {
  it('sets the scene-wide default hooks while it is mounted, and changes them with its props', async () => {
    renderer = await ReactThreeTestRenderer.create(<SceneShaderHooks hooks={{ leaves: pale }} />, { gl });
    expect(getSceneShaderHooks()).toEqual({ leaves: [pale] });
    await renderer.update(<SceneShaderHooks hooks={{ bark: dusk }} />);
    expect(getSceneShaderHooks()).toEqual({ bark: [dusk] });
    await renderer.unmount();
    renderer = undefined;
    expect(getSceneShaderHooks()).toEqual({});
  });

  it('several stack in the order they were mounted, after the hooks the scene already had', async () => {
    setSceneShaderHooks({ leaves: dusk });
    renderer = await ReactThreeTestRenderer.create(
      <>
        <SceneShaderHooks hooks={{ leaves: pale }} />
        <SceneShaderHooks hooks={{ bark: dusk }} />
      </>,
      { gl },
    );
    expect(getSceneShaderHooks()).toEqual({ leaves: [dusk, pale], bark: [dusk] });
    await renderer.update(<SceneShaderHooks hooks={{ leaves: pale }} />);
    expect(getSceneShaderHooks()).toEqual({ leaves: [dusk, pale] });
    await renderer.unmount();
    renderer = undefined;
    expect(getSceneShaderHooks()).toEqual({ leaves: dusk });
  });

  it('a tree picks the scene-wide hooks up', async () => {
    renderer = await ReactThreeTestRenderer.create(
      <>
        <SceneShaderHooks hooks={{ leaves: pale }} />
        <Tree definition={definition} />
      </>,
      { gl },
    );
    const tree = found<TreeObject>(renderer, 'isTree');
    expect(tree.leaves.material.vertexColors).toBe(false); // the hook multiplies the vertex colours in itself
    await renderer.update(<Tree definition={definition} />);
    expect(tree.leaves.material.vertexColors).toBe(true);
  });
});
