import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { texture, vec4 } from 'three/tsl';
import { createTree } from '../../src/index';
import { MeshStandardNodeMaterial, PerspectiveCamera, Scene, Texture, type Renderer } from 'three/webgpu';
import { applyTreeEffects, createTreeEffects, SUGGESTED_TREE_EFFECTS, treePartOf } from '../../src/effects';

describe('Tree Effects', () => {
  it('suggests a combination of effects for each built-in Style', () => {
    expect(Object.keys(SUGGESTED_TREE_EFFECTS).sort()).toEqual(['low-poly', 'realistic', 'stylized']);
    for (const settings of Object.values(SUGGESTED_TREE_EFFECTS)) {
      expect(Object.keys(settings).length).toBeGreaterThan(0);
    }
  });

  it('tells tree materials (bark, leaves) from the rest of the scene', () => {
    const tree = createTree({ schemaVersion: 2, leaves: { count: 2 } }, { seed: 1 });
    expect(treePartOf(tree.wood.material)).toBe('bark');
    expect(treePartOf(tree.leaves.material)).toBe('leaves');
    expect(treePartOf(tree.leaves.material.clone())).toBe('leaves');
    expect(treePartOf(new MeshStandardNodeMaterial())).toBeNull();
    expect(treePartOf(null)).toBeNull();
  });

  it('leaves the colour untouched without effects and composes the chosen ones onto it', () => {
    const input = { color: vec4(0.2, 0.4, 0.1, 1), mask: texture(new Texture()) };
    expect(applyTreeEffects(input, {})).toBe(input.color);
    expect(applyTreeEffects(input, { grade: { saturation: 2 } })).not.toBe(input.color);
  });

  it('switches between the suggested combinations of the Styles in one pipeline', () => {
    const renderer = { isWebGPURenderer: true } as unknown as Renderer;
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'low-poly' });
    expect(effects.settings).toBe(SUGGESTED_TREE_EFFECTS['low-poly']);
    const before = effects.pipeline.outputNode;
    effects.set('stylized');
    expect(effects.settings).toBe(SUGGESTED_TREE_EFFECTS.stylized);
    expect(effects.pipeline.outputNode).not.toBe(before);
    effects.set(null);
    expect(effects.settings).toEqual({});
    expect(effects.pipeline.outputNode).toBe(effects.scenePass.color);
    expect(() => effects.set('unknown' as never)).toThrow(/unknown/);
  });
});

describe('/effects packaging', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  it('is published as the @casmo/tree.js/effects subpath and not pulled in by the core entry', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.exports['./effects']).toEqual({ types: './dist/effects/index.d.ts', import: './dist/effects.js' });
    expect(read('src/index.ts')).not.toMatch(/\.\/effects/);
  });
});
