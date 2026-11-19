import { describe, expect, it, vi } from 'vitest';
import { uniform, vec4 } from 'three/tsl';
import { PerspectiveCamera, Scene, type Node, type Renderer } from 'three/webgpu';
import { SUGGESTED_TREE_EFFECTS, TREE_ID, TREE_MASK, type CustomTreeEffect, type TreeEffectInput } from '../../src/effects';
import { createScenePipeline, SUGGESTED_SCENE_EFFECTS, type ScenePipeline, type ScenePipelineOptions } from '../../src/scene';

// SMAA loads its lookup textures through `new Image()`, which Node does not have.
vi.stubGlobal('Image', class {
  src = '';
});

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const create = (options?: ScenePipelineOptions) => createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), options);
const outputsOf = (pipeline: ScenePipeline) => Object.keys(pipeline.scenePass.pass.getMRT()!.outputNodes);

/** A custom effect that tints leaf pixels by a uniform amount and records every build (its input and node). */
function tint(position: Pick<CustomTreeEffect<number>, 'before' | 'channels'> = {}) {
  const builds: { input: TreeEffectInput; node: Node<'vec4'>; amount: { value: number } }[] = [];
  const effect: CustomTreeEffect<number> = {
    ...position,
    build(input, amount) {
      const value = uniform(amount);
      const node = vec4(input.color.rgb.add(input.mask.g.mul(value)), input.color.a);
      builds.push({ input, node, amount: value });
      return { node, update: (next) => (value.value = next) };
    },
  };
  return { effect, builds, last: () => builds[builds.length - 1]! };
}

describe('Scene Pipeline: custom Tree Effects among the built-in Tree Effects', () => {
  it('runs a custom effect after the built-in Tree Effects by default, and the Scene Effects after it', () => {
    const custom = tint();
    const pipeline = create({ treeEffects: 'stylized' });
    pipeline.addEffect(custom.effect, 0.5);
    expect(custom.last().input.color, 'after the grade, glow, Inner Lines and outline').not.toBe(pipeline.scenePass.color);
    expect(pipeline.pipeline.outputNode, 'no Scene Effects: the custom effect is the output').toBe(custom.last().node);

    pipeline.set({ style: 'stylized' });
    expect(pipeline.pipeline.outputNode, 'the Scene Effects run after it').not.toBe(custom.last().node);
    expect(pipeline.customEffects).toEqual([custom.effect]);
  });

  it('runs a custom effect before the built-in Tree Effect it names', () => {
    const first = tint({ before: 'grade' });
    const outline = tint({ before: 'outline' });
    const pipeline = create({ treeEffects: { outline: {} } });
    pipeline.addEffect(outline.effect, 0.5);
    expect(outline.last().input.color, 'nothing runs before it').toBe(pipeline.scenePass.color);
    expect(pipeline.pipeline.outputNode, 'the outline runs after it').not.toBe(outline.last().node);

    pipeline.set({ style: 'stylized' });
    pipeline.addEffect(first.effect, 1);
    expect(first.last().input.color, 'before the grade: the scene colour itself').toBe(pipeline.scenePass.color);
    expect(outline.last().input.color, 'after the grade, glow and Inner Lines').not.toBe(pipeline.scenePass.color);
  });

  it("runs a custom effect after every built-in Tree Effect, the Highlight too, with before: 'end', and the Scene Effects after it", () => {
    const custom = tint({ before: 'end' });
    const underHighlight = tint();
    const pipeline = create({ treeEffects: { ...SUGGESTED_TREE_EFFECTS.stylized, highlight: {} } });
    pipeline.addEffect(underHighlight.effect, 0.2);
    pipeline.addEffect(custom.effect, 0.5);
    expect(pipeline.pipeline.outputNode, 'no Scene Effects: the custom effect is the output').toBe(custom.last().node);
    expect(custom.last().input.color, 'the Highlight ran before it').not.toBe(underHighlight.last().node);

    pipeline.set({ style: 'stylized' });
    expect(pipeline.pipeline.outputNode, 'the Scene Effects run after it').not.toBe(custom.last().node);
  });

  it('runs custom effects at the same position in the order they were added', () => {
    const a = tint();
    const b = tint();
    const pipeline = create();
    pipeline.addEffect(a.effect, 0.1);
    pipeline.addEffect(b.effect, 0.2);
    expect(a.last().input.color).toBe(pipeline.scenePass.color);
    expect(b.last().input.color).toBe(a.last().node);
    expect(pipeline.pipeline.outputNode).toBe(b.last().node);
    expect(pipeline.customEffects).toEqual([a.effect, b.effect]);
  });
});

describe('Scene Pipeline: custom Tree Effects through add, update, remove and set()', () => {
  it('keeps custom effects across set(), also when set() builds a new graph or a new scene pass', () => {
    const custom = tint();
    const pipeline = create({ style: 'realistic' });
    pipeline.addEffect(custom.effect, 0.5);
    const choices = [{ style: 'stylized' }, { style: 'low-poly' }, {}, { treeEffects: { grade: { saturation: 2 } } }, { sceneEffects: { motionBlur: {} } }] as const;
    for (const choice of choices) {
      pipeline.set(choice);
      expect(pipeline.customEffects).toEqual([custom.effect]);
      expect(custom.last().input.mask, `${JSON.stringify(choice)}: it reads the current scene pass`).toBe(pipeline.scenePass.mask);
    }
    pipeline.set({ treeEffects: null, sceneEffects: null });
    expect(pipeline.pipeline.outputNode, 'nothing else on: the custom effect is the output').toBe(custom.last().node);
  });

  it('keeps the graph (and the custom effect) when set() changes only colours and numbers', () => {
    const custom = tint();
    const pipeline = create({ style: 'stylized' });
    pipeline.addEffect(custom.effect, 0.5);
    const output = pipeline.pipeline.outputNode;
    pipeline.set({ treeEffects: { ...SUGGESTED_TREE_EFFECTS.stylized, grade: { saturation: 0.1 } }, sceneEffects: 'stylized' });
    expect(pipeline.pipeline.outputNode).toBe(output);
    expect(custom.builds).toHaveLength(1);
  });

  it('updates a custom effect live, without a new graph, and rebuilds it with its latest options', () => {
    const custom = tint();
    const pipeline = create({ style: 'realistic' });
    pipeline.addEffect(custom.effect, 0.5);
    const output = pipeline.pipeline.outputNode;
    pipeline.updateEffect(custom.effect, 0.8);
    expect(custom.last().amount.value).toBe(0.8);
    expect(pipeline.pipeline.outputNode).toBe(output);
    pipeline.set({ style: 'stylized' }); // a new graph
    expect(custom.builds).toHaveLength(2);
    expect(custom.last().amount.value).toBe(0.8);
  });

  it('removes a custom effect, and renders with renderer.render() itself again when nothing else is on', () => {
    const render = vi.fn();
    const fake = { isWebGPURenderer: true, render } as unknown as Renderer;
    const pipeline = createScenePipeline(fake, new Scene(), new PerspectiveCamera());
    const pipelineRender = vi.spyOn(pipeline.pipeline, 'render').mockImplementation(() => {});
    const custom = tint();
    pipeline.addEffect(custom.effect, 0.5);
    pipeline.render();
    expect(pipelineRender, 'a custom effect alone runs in the pipeline').toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();

    pipeline.removeEffect(custom.effect);
    expect(pipeline.customEffects).toEqual([]);
    expect(pipeline.pipeline.outputNode).toBe(pipeline.scenePass.color);
    pipeline.render();
    expect(render).toHaveBeenCalledTimes(1);
    pipeline.removeEffect(custom.effect); // not there: nothing happens
    expect(() => pipeline.updateEffect(custom.effect, 1)).toThrow(/addEffect/);
    pipeline.addEffect(custom.effect, 0.5);
    expect(() => pipeline.addEffect(custom.effect, 0.5)).toThrow(/updateEffect/);
  });
});

describe('Scene Pipeline: custom Tree Effects and the channel-set rule (ADR 0009)', () => {
  it('adds no channel and keeps the scene pass for a custom effect that declares none', () => {
    const pipeline = create({ style: 'realistic' });
    const pass = pipeline.scenePass;
    const outputs = outputsOf(pipeline);
    const custom = tint();
    pipeline.addEffect(custom.effect, 0.5);
    expect(pipeline.scenePass).toBe(pass);
    expect(outputsOf(pipeline)).toEqual(outputs);
    expect(custom.last().input.treeId).toBeUndefined();
    expect(custom.last().input.normal).toBeUndefined();
  });

  it('adds the channels a custom effect declares, gives them to it, and drops them with it', () => {
    const custom = tint({ channels: { treeId: true, normal: true } });
    const pipeline = create({ treeEffects: 'realistic', sceneEffects: { ...SUGGESTED_SCENE_EFFECTS.realistic, godrays: undefined } });
    expect(outputsOf(pipeline)).toEqual(['output', TREE_MASK]);
    pipeline.addEffect(custom.effect, 0.5);
    expect(outputsOf(pipeline).sort()).toEqual(['normal', 'output', TREE_ID, TREE_MASK].sort());
    expect(custom.last().input.treeId).toBe(pipeline.scenePass.treeId);
    expect(custom.last().input.normal).toBe(pipeline.scenePass.normal);

    pipeline.removeEffect(custom.effect);
    expect(outputsOf(pipeline)).toEqual(['output', TREE_MASK]);
  });

  it('never hands an undeclared channel to a custom effect, even when a built-in effect has it on', () => {
    const custom = tint({ channels: { normal: true } });
    const pipeline = create({ style: 'low-poly' });
    pipeline.addEffect(custom.effect, 0.5);
    expect(pipeline.scenePass.treeId).toBeDefined();
    expect(custom.last().input.treeId).toBeUndefined();
    expect(custom.last().input.normal).toBe(pipeline.scenePass.normal);
  });
});
