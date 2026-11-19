import { describe, expect, it } from 'vitest';
import { uniform, vec4 } from 'three/tsl';
import { PerspectiveCamera, Scene, type Node, type Renderer } from 'three/webgpu';
import { createTreeEffects, SUGGESTED_TREE_EFFECTS, TREE_ID, TREE_MASK, type CustomTreeEffect, type TreeEffectInput, type TreeEffects } from '../../src/effects';

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const make = (effects: Parameters<typeof createTreeEffects>[3] = {}) => createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), effects);
const outputsOf = (effects: TreeEffects) => Object.keys(effects.scenePass.pass.getMRT()!.outputNodes);

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

describe('Custom Tree Effects: position among the built-in Tree Effects', () => {
  it('runs a custom effect last by default, after every built-in effect but before the Highlight', () => {
    const custom = tint();
    const effects = make({ effects: 'stylized' });
    effects.addEffect(custom.effect, 0.5);
    expect(effects.pipeline.outputNode).toBe(custom.last().node);
    expect(custom.last().input.color).not.toBe(effects.scenePass.color);

    effects.set({ ...SUGGESTED_TREE_EFFECTS.stylized, highlight: {} });
    expect(effects.pipeline.outputNode).not.toBe(custom.last().node);
  });

  it('runs a custom effect before the built-in effect it names, e.g. before the outline', () => {
    const custom = tint({ before: 'outline' });
    const effects = make({ effects: { outline: {} } });
    effects.addEffect(custom.effect, 0.5);
    expect(custom.last().input.color, 'nothing runs before it').toBe(effects.scenePass.color);
    expect(effects.pipeline.outputNode, 'the outline runs after it').not.toBe(custom.last().node);

    const first = tint({ before: 'grade' });
    effects.set('stylized');
    effects.addEffect(first.effect, 1);
    expect(first.last().input.color, 'before the grade: the scene colour itself').toBe(effects.scenePass.color);
    expect(custom.last().input.color, 'after the grade, glow and Inner Lines').not.toBe(effects.scenePass.color);
  });

  it("runs a custom effect after every built-in effect, the Highlight too, with before: 'end'", () => {
    const custom = tint({ before: 'end' });
    const underHighlight = tint();
    const effects = make({ effects: { ...SUGGESTED_TREE_EFFECTS.stylized, highlight: {} } });
    effects.addEffect(underHighlight.effect, 0.2);
    effects.addEffect(custom.effect, 0.5);
    expect(effects.pipeline.outputNode, 'nothing runs after it').toBe(custom.last().node);
    expect(custom.last().input.color, 'the Highlight ran before it').not.toBe(underHighlight.last().node);
    expect(effects.pipeline.outputNode).not.toBe(underHighlight.last().node);

    effects.set({ ...SUGGESTED_TREE_EFFECTS.stylized, highlight: {} });
    expect(effects.pipeline.outputNode, 'kept at the end across set()').toBe(custom.last().node);
  });

  it('runs custom effects at the same position in the order they were added', () => {
    const a = tint();
    const b = tint();
    const effects = make();
    effects.addEffect(a.effect, 0.1);
    effects.addEffect(b.effect, 0.2);
    expect(a.last().input.color).toBe(effects.scenePass.color);
    expect(b.last().input.color).toBe(a.last().node);
    expect(effects.pipeline.outputNode).toBe(b.last().node);
    expect(effects.customEffects).toEqual([a.effect, b.effect]);
  });
});

describe('Custom Tree Effects: add, update, remove, and set()', () => {
  it('keeps custom effects across set(), also when set() builds a new graph or a new scene pass', () => {
    const custom = tint();
    const effects = make({ effects: 'realistic' });
    effects.addEffect(custom.effect, 0.5);
    for (const choice of ['stylized', 'low-poly', null, { grade: { saturation: 2 } }] as const) {
      effects.set(choice);
      expect(effects.customEffects).toEqual([custom.effect]);
      expect(effects.pipeline.outputNode, `${JSON.stringify(choice)}: the custom effect is in the graph`).toBe(custom.last().node);
      expect(custom.last().input.mask, 'it reads the current scene pass').toBe(effects.scenePass.mask);
    }
  });

  it('keeps the graph (and the custom effect) when set() changes only colours and numbers', () => {
    const custom = tint();
    const effects = make({ effects: 'stylized' });
    effects.addEffect(custom.effect, 0.5);
    const output = effects.pipeline.outputNode;
    effects.set({ ...SUGGESTED_TREE_EFFECTS.stylized, grade: { saturation: 0.1 } });
    expect(effects.pipeline.outputNode).toBe(output);
    expect(custom.builds).toHaveLength(1);
  });

  it('updates a custom effect live, without a new graph, and rebuilds it with its latest options', () => {
    const custom = tint();
    const effects = make({ effects: 'realistic' });
    effects.addEffect(custom.effect, 0.5);
    const output = effects.pipeline.outputNode;
    effects.updateEffect(custom.effect, 0.8);
    expect(custom.last().amount.value).toBe(0.8);
    expect(effects.pipeline.outputNode).toBe(output);
    effects.set('stylized'); // a new graph
    expect(custom.builds).toHaveLength(2);
    expect(custom.last().amount.value).toBe(0.8);
  });

  it('removes a custom effect, leaving the graph of the built-in effects alone', () => {
    const custom = tint();
    const effects = make();
    effects.addEffect(custom.effect, 0.5);
    effects.removeEffect(custom.effect);
    expect(effects.customEffects).toEqual([]);
    expect(effects.pipeline.outputNode).toBe(effects.scenePass.color);
    effects.removeEffect(custom.effect); // not there: nothing happens
    expect(() => effects.updateEffect(custom.effect, 1)).toThrow(/addEffect/);
  });

  it('refuses to add the same effect twice', () => {
    const custom = tint();
    const effects = make();
    effects.addEffect(custom.effect, 0.5);
    expect(() => effects.addEffect(custom.effect, 0.5)).toThrow(/updateEffect/);
  });
});

describe('Custom Tree Effects: channels (ADR 0009)', () => {
  it('adds no channel and changes nothing without custom effects, or for one that declares none', () => {
    const plain = make({ effects: 'realistic' });
    const pass = plain.scenePass;
    expect(outputsOf(plain)).toEqual(['output', TREE_MASK]);
    const custom = tint();
    plain.addEffect(custom.effect, 0.5);
    expect(plain.scenePass, 'the same scene pass (no recompile of the scene)').toBe(pass);
    expect(outputsOf(plain)).toEqual(['output', TREE_MASK]);
    expect(custom.last().input.treeId).toBeUndefined();
    expect(custom.last().input.normal).toBeUndefined();
  });

  it('adds the channels a custom effect declares, and gives them to it', () => {
    const custom = tint({ channels: { treeId: true, normal: true } });
    const effects = make({ effects: 'realistic' });
    effects.addEffect(custom.effect, 0.5);
    expect(outputsOf(effects).sort()).toEqual(['normal', 'output', TREE_ID, TREE_MASK].sort());
    expect(custom.last().input.treeId).toBe(effects.scenePass.treeId);
    expect(custom.last().input.normal).toBe(effects.scenePass.normal);
    expect(custom.last().input.normalEncoding).toBe('color');
  });

  it('adds only the declared channel, and never hands an undeclared one to the effect', () => {
    const custom = tint({ channels: { normal: true } });
    const effects = make({ effects: 'realistic' });
    effects.addEffect(custom.effect, 0.5);
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK, 'normal']);

    // low-poly turns the Tree ID on for its own outline; the custom effect did not ask for it.
    effects.set('low-poly');
    expect(effects.scenePass.treeId).toBeDefined();
    expect(custom.last().input.treeId).toBeUndefined();
    expect(custom.last().input.normal).toBe(effects.scenePass.normal);
  });

  it('drops the channel again with the effect that declared it, unless a built-in effect needs it', () => {
    const custom = tint({ channels: { treeId: true } });
    const effects = make({ effects: 'realistic' });
    effects.addEffect(custom.effect, 0.5);
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK, TREE_ID]);
    effects.removeEffect(custom.effect);
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK]);
    expect(effects.scenePass.treeId).toBeUndefined();
  });
});
