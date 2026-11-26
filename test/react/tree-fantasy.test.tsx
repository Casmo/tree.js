import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { DEFAULT_INNER_GLOW, hashTreeData, type Tree as TreeObject } from '../../src/index';
import { generateTree } from '../../src/generator';
import { Tree } from '../../src/react';
import { oak } from '../../src/species';
import whimsical from '../../src/styles/whimsical';
import enchanted from '../../src/styles/enchanted';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;
/** A stand-in WebGPURenderer: the test renderer's default is the classic WebGLRenderer, which tree.js refuses (ADR 0002). */
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

describe('<Tree> with a Fantasy Style Definition (React Three Fiber)', () => {
  it('draws a Whimsical Definition: the same twisted tree, in the whimsical material with a Leaf Palette', async () => {
    const definition = whimsical.apply(oak);
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} seed={7} />, { gl });
    const tree = sceneTree(renderer);
    expect(tree.definition.materials.shading).toBe('whimsical');
    expect(tree.definition.trunk.twistStyle).toBe('corkscrew');
    expect(hashTreeData(tree.data)).toBe(hashTreeData(generateTree(definition, 7)));
    expect((tree.wood.material as { isWhimsicalMaterial?: boolean }).isWhimsicalMaterial).toBe(true);
    expect((tree.leaves.material as { isWhimsicalMaterial?: boolean }).isWhimsicalMaterial).toBe(true);
    expect(tree.leafPalette).not.toBeNull();
    expect(tree.innerGlow).toBeNull();
  });

  it('draws an Enchanted Definition with its Inner Glow, tunable live through the tree', async () => {
    const definition = enchanted.apply(oak);
    renderer = await ReactThreeTestRenderer.create(<Tree definition={definition} seed={7} />, { gl });
    const tree = sceneTree(renderer);
    expect(tree.definition.materials.shading).toBe('enchanted');
    expect(tree.definition.trunk.twistStyle).toBe('snake');
    expect(hashTreeData(tree.data)).toBe(hashTreeData(generateTree(definition, 7)));
    expect((tree.wood.material as { isEnchantedMaterial?: boolean }).isEnchantedMaterial).toBe(true);
    expect(tree.leaves.material.emissiveNode).not.toBeNull();
    expect(tree.innerGlow).toEqual(DEFAULT_INNER_GLOW);
  });

  it('switching the Definition from Whimsical to Enchanted regenerates the tree in the new Style', async () => {
    renderer = await ReactThreeTestRenderer.create(<Tree definition={whimsical.apply(oak)} seed={7} />, { gl });
    const before = sceneTree(renderer);
    await renderer.update(<Tree definition={enchanted.apply(oak)} seed={7} />);
    expect(sceneTree(renderer)).not.toBe(before);
    expect(sceneTree(renderer).innerGlow).toEqual(DEFAULT_INNER_GLOW);
  });
});
