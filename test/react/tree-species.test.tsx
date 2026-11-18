import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { hashTreeData, type Tree as TreeObject } from '../../src/index';
import { generateTree } from '../../src/generator';
import { Tree } from '../../src/react';
import { oak } from '../../src/species';
import lowPoly from '../../src/styles/low-poly';
import stylized from '../../src/styles/stylized';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;
const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;

let renderer: Renderer | undefined;
afterEach(async () => {
  await renderer?.unmount();
  renderer = undefined;
});

function sceneTree(r: Renderer): TreeObject {
  const trees = r.scene.children.map((c) => c.instance).filter((o) => (o as Partial<TreeObject>).isTree);
  expect(trees).toHaveLength(1);
  return trees[0] as TreeObject;
}

describe('<Tree species style> (React Three Fiber)', () => {
  it('grows the Species in the Style: the same tree as style.apply(species)', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree species={oak} style={lowPoly} seed={7} />, { gl });
    const tree = sceneTree(renderer);
    expect(tree.definition.species).toBe('oak');
    expect(hashTreeData(tree.data)).toBe(hashTreeData(generateTree(lowPoly.apply(oak), 7)));
  });

  it('a re-render with the same Species keeps the tree; another Style regenerates it', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree species={oak} style={lowPoly} seed={7} />, { gl });
    const before = sceneTree(renderer);
    await renderer.update(<Tree species={{ ...oak }} style={lowPoly} seed={7} growth={0.5} />);
    expect(sceneTree(renderer)).toBe(before);
    await renderer.update(<Tree species={oak} style={stylized} seed={7} />);
    expect(sceneTree(renderer)).not.toBe(before);
    expect(sceneTree(renderer).definition.materials.shading).toBe('toon');
  });
});
