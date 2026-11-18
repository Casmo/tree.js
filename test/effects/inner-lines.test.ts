import { describe, expect, it } from 'vitest';
import { texture, vec4 } from 'three/tsl';
import { PerspectiveCamera, Scene, Texture, UnsignedByteType, type Renderer } from 'three/webgpu';
import { applyTreeEffects, createTreeEffects, innerLines, TREE_MASK, treeEffectsPass, treeNormalMRT, type TreeEffects } from '../../src/effects';

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const outputsOf = (effects: TreeEffects) => Object.keys(effects.scenePass.pass.getMRT()!.outputNodes);
const plainInput = () => ({ color: vec4(0.2, 0.4, 0.1, 1), mask: texture(new Texture()) });

describe('Inner Lines', () => {
  it('treeNormalMRT() renders view normals to a target named normal', () => {
    expect(Object.keys(treeNormalMRT().outputNodes)).toEqual(['normal']);
  });

  it('treeEffectsPass gives depth and camera always, and the normal (color encoding, RGBA8) on request', () => {
    const camera = new PerspectiveCamera();
    const plain = treeEffectsPass(new Scene(), camera);
    expect(Object.keys(plain.pass.getMRT()!.outputNodes)).toEqual(['output', TREE_MASK]);
    expect(plain.depth).toBeDefined();
    expect(plain.camera).toBe(camera);
    expect(plain.normal).toBeUndefined();

    const input = treeEffectsPass(new Scene(), camera, null, { normal: true });
    expect(Object.keys(input.pass.getMRT()!.outputNodes)).toEqual(['output', TREE_MASK, 'normal']);
    expect(input.pass.getTexture('normal').type).toBe(UnsignedByteType);
    expect(input.normal?.value).toBe(input.pass.getTexture('normal'));
    expect(input.normalEncoding).toBe('color');
  });

  it('throws an error naming the missing input', () => {
    const camera = new PerspectiveCamera();
    const depth = texture(new Texture());
    const normal = texture(new Texture());
    expect(() => innerLines({ ...plainInput(), depth, camera }, {})).toThrow(/normal/);
    expect(() => innerLines({ ...plainInput(), normal, camera }, {})).toThrow(/depth/);
    expect(() => innerLines({ ...plainInput(), normal, depth }, {})).toThrow(/camera/);
    expect(() => applyTreeEffects(plainInput(), { innerLines: {} })).toThrow(/depth|normal/);
  });

  it('works with an app normal texture in either encoding', () => {
    const input = { ...plainInput(), depth: texture(new Texture()), camera: new PerspectiveCamera(), normal: texture(new Texture()) };
    for (const normalEncoding of [undefined, 'color', 'direction'] as const) {
      const node = innerLines({ ...input, normalEncoding }, { thickness: 2 });
      expect(node).not.toBe(input.color);
    }
    expect(applyTreeEffects(input, { innerLines: {} })).not.toBe(input.color);
  });

  it('adds the normal channel to TreeEffects only with innerLines', () => {
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'stylized' });
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK]);
    effects.set({ innerLines: {} });
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK, 'normal']);
    expect(effects.scenePass.pass.getTexture(TREE_MASK).type).toBe(UnsignedByteType);
    effects.set({ outline: {} });
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK]);
  });

  it('keeps the graph when set() changes only Inner Lines colours and numbers, and rebuilds when toggled', () => {
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: { outline: {}, innerLines: {} } });
    const before = effects.pipeline.outputNode;
    effects.set({ outline: {}, innerLines: { color: '#ff0000', thickness: 3, strength: 0.5, normalThreshold: 0.2, depthThreshold: 0.1 } });
    expect(effects.pipeline.outputNode).toBe(before);
    const scenePass = effects.scenePass;
    effects.set({ outline: {} });
    expect(effects.pipeline.outputNode).not.toBe(before);
    expect(effects.scenePass).not.toBe(scenePass);
  });
});
