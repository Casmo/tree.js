import { describe, expect, it } from 'vitest';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { vec4 } from 'three/tsl';
import { createTree } from '../../src/index';
import { Mesh, BoxGeometry, Group, PerspectiveCamera, Scene, type Renderer } from 'three/webgpu';
import { applyTreeEffects, createTreeEffects, findTreeMeshes, TREE_EFFECT_PRESETS, treePartOf } from '../../src/effects';

describe('Tree Effects', () => {
  it('suggests a combination of effects for each built-in Style', () => {
    expect(Object.keys(TREE_EFFECT_PRESETS).sort()).toEqual(['low-poly', 'realistic', 'stylized']);
    for (const preset of Object.values(TREE_EFFECT_PRESETS)) {
      expect(Object.keys(preset).length).toBeGreaterThan(0);
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
    const input = { color: vec4(0.2, 0.4, 0.1, 1), mask: vec4(1, 1, 0, 1) };
    expect(applyTreeEffects(input, {})).toBe(input.color);
    expect(applyTreeEffects(input, { grade: { saturation: 2 } })).not.toBe(input.color);
    expect(() => applyTreeEffects(input, { outline: {} })).toThrow(/target/);
  });

  it('finds the tree meshes in a scene', () => {
    const scene = new Scene();
    const tree = createTree({ schemaVersion: 2, leaves: { count: 2 } }, { seed: 1 });
    const group = new Group().add(tree);
    scene.add(group, new Mesh(new BoxGeometry(), new MeshStandardNodeMaterial()));
    expect(findTreeMeshes(scene)).toEqual([tree.wood, tree.leaves]);
  });

  it('switches between the suggested combinations of the Styles in one pipeline', () => {
    const renderer = { isWebGPURenderer: true } as unknown as Renderer;
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'low-poly' });
    expect(effects.preset).toBe(TREE_EFFECT_PRESETS['low-poly']);
    const before = effects.pipeline.outputNode;
    effects.set('stylized');
    expect(effects.preset).toBe(TREE_EFFECT_PRESETS.stylized);
    expect(effects.pipeline.outputNode).not.toBe(before);
    effects.set(null);
    expect(effects.preset).toEqual({});
    expect(effects.pipeline.outputNode).toBe(effects.scenePass.color);
    expect(() => effects.set('unknown' as never)).toThrow(/unknown/);
  });
});
