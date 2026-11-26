import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { texture, vec4 } from 'three/tsl';
import { createTree } from '../../src/index';
import { MeshStandardNodeMaterial, PerspectiveCamera, Scene, Texture, UnsignedByteType, UnsignedIntType, type Node, type Renderer } from 'three/webgpu';
import {
  applyTreeEffects,
  createTreeEffects,
  SUGGESTED_TREE_EFFECTS,
  TREE_ID,
  TREE_MASK,
  treeEffectsPass,
  treeOutline,
  treePartOf,
  type TreeEffects,
} from '../../src/effects';

describe('Tree Effects', () => {
  it('suggests a combination of effects for each built-in Style', () => {
    expect(Object.keys(SUGGESTED_TREE_EFFECTS).sort()).toEqual(['low-poly', 'painterly', 'realistic', 'stylized', 'whimsical']);
    for (const settings of Object.values(SUGGESTED_TREE_EFFECTS)) {
      expect(Object.keys(settings).length).toBeGreaterThan(0);
    }
  });

  it('suggests Inner Lines and lines between trees for low-poly, soft Inner Lines for stylized', () => {
    expect(SUGGESTED_TREE_EFFECTS['low-poly'].innerLines).toEqual({ color: '#18230f', thickness: 1, strength: 0.8 });
    expect(SUGGESTED_TREE_EFFECTS['low-poly'].outline?.betweenTrees).toBe(true);
    expect(SUGGESTED_TREE_EFFECTS.stylized.innerLines).toEqual({ color: '#2b3a1c', thickness: 1, strength: 0.45, normalThreshold: 0.5 });
    expect(SUGGESTED_TREE_EFFECTS.stylized.outline?.betweenTrees).toBeUndefined();
  });

  it('keeps the realistic suggestion unchanged and puts Highlight in no suggestion', () => {
    expect(SUGGESTED_TREE_EFFECTS.realistic).toEqual({
      grade: { exposure: 1.05, contrast: 1.08, saturation: 0.95, tint: '#fff5e6' },
      glow: { color: '#e8ffc0', intensity: 0.35, threshold: 0.12, radius: 4 },
    });
    for (const settings of Object.values(SUGGESTED_TREE_EFFECTS)) expect(settings).not.toHaveProperty('highlight');
  });

  it('tells tree materials (bark, leaves, fruit) from the rest of the scene', () => {
    const tree = createTree({ schemaVersion: 2, leaves: { count: 2 } }, { seed: 1 });
    expect(treePartOf(tree.wood.material)).toBe('bark');
    expect(treePartOf(tree.leaves.material)).toBe('leaves');
    expect(treePartOf(tree.leaves.material.clone())).toBe('leaves');
    const fruiting = createTree({ schemaVersion: 3, fruit: { type: 'pear' } }, { seed: 1 });
    expect(treePartOf(fruiting.fruit.material)).toBe('fruit');
    expect(treePartOf(fruiting.fruit.material.clone())).toBe('fruit');
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

  it('keeps the graph when set() changes only colours and numbers of the same effects', () => {
    const renderer = { isWebGPURenderer: true } as unknown as Renderer;
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'stylized' });
    const before = effects.pipeline.outputNode;
    const tweaked = {
      grade: { saturation: 1.4, contrast: 0.9, exposure: 1.2, tint: '#ddeeff' },
      glow: { color: '#ff0000', intensity: 1, threshold: 0.05, radius: SUGGESTED_TREE_EFFECTS.stylized.glow!.radius },
      innerLines: { color: '#00ff00', thickness: 2, strength: 0.9, normalThreshold: 0.3 },
      outline: { color: '#ff00ff', thickness: 4, strength: 0.3 },
    };
    effects.set(tweaked);
    expect(effects.settings).toBe(tweaked);
    expect(effects.pipeline.outputNode).toBe(before);
    effects.set('stylized');
    expect(effects.pipeline.outputNode).toBe(before);
  });

  it('builds a new graph when set() switches an effect on or off or changes the glow radius', () => {
    const renderer = { isWebGPURenderer: true } as unknown as Renderer;
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'stylized' });
    const { grade, glow, outline } = SUGGESTED_TREE_EFFECTS.stylized;
    effects.set({ grade, glow, outline });
    const outputs = new Set([effects.pipeline.outputNode]);
    effects.set({ grade, glow }); // outline off
    outputs.add(effects.pipeline.outputNode);
    effects.set({ grade, glow: { ...glow, radius: 3 } }); // other blur radius
    outputs.add(effects.pipeline.outputNode);
    effects.set({ grade, glow: { ...glow, radius: 3 }, outline }); // outline on again
    outputs.add(effects.pipeline.outputNode);
    expect(outputs.size).toBe(4);
  });

  it('frees the blur of the old graph when the shape changes, not when only values change', () => {
    const renderer = { isWebGPURenderer: true } as unknown as Renderer;
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: { glow: { radius: 4 } } });
    const blurs = findNodes(effects.pipeline.outputNode, (node) => 'isGaussianBlurNode' in node);
    expect(blurs.length).toBeGreaterThan(0);
    const disposed = vi.fn();
    for (const blur of blurs) blur.addEventListener('dispose', disposed);
    effects.set({ glow: { radius: 4, intensity: 2 } });
    expect(disposed).not.toHaveBeenCalled();
    effects.set({ glow: { radius: 5 } });
    expect(disposed).toHaveBeenCalledTimes(blurs.length);
  });
});

describe('TreeEffects channels', () => {
  const renderer = { isWebGPURenderer: true } as unknown as Renderer;
  const outputsOf = (effects: TreeEffects) => Object.keys(effects.scenePass.pass.getMRT()!.outputNodes);

  it('renders exactly { output, treeMask } with an 8-bit mask without new settings', () => {
    const lowPolyBefore = { grade: { saturation: 1.15, contrast: 1.1 }, outline: { color: '#18230f', thickness: 2, strength: 0.9 } };
    for (const choice of [null, 'realistic', lowPolyBefore, { grade: {}, glow: {}, outline: {} }] as const) {
      const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: choice });
      expect(outputsOf(effects)).toEqual(['output', TREE_MASK]);
      expect(effects.scenePass.pass.getTexture(TREE_MASK).type).toBe(UnsignedByteType);
      expect(effects.scenePass.treeId).toBeUndefined();
    }
    expect(Object.keys(treeEffectsPass(new Scene(), new PerspectiveCamera()).pass.getMRT()!.outputNodes)).toEqual(['output', TREE_MASK]);
  });

  it('adds the normal channel for the stylized suggestion and the normal and Tree ID channels for low-poly', () => {
    expect(outputsOf(createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'stylized' }))).toEqual(['output', TREE_MASK, 'normal']);
    const lowPoly = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'low-poly' });
    expect(outputsOf(lowPoly).sort()).toEqual(['normal', 'output', TREE_ID, TREE_MASK].sort());
    expect(lowPoly.scenePass.pass.getTexture(TREE_MASK).type).toBe(UnsignedByteType);
  });

  it('adds the Tree ID channel with treeId: true, and gives the effects its texture as input', () => {
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'realistic', treeId: true });
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK, TREE_ID]);
    expect(effects.scenePass.pass.getTexture(TREE_MASK).type).toBe(UnsignedByteType);
    expect(effects.scenePass.pass.getTexture(TREE_ID).type).toBe(UnsignedIntType);
    expect(effects.scenePass.treeId).toBeDefined();
    const input = treeEffectsPass(new Scene(), new PerspectiveCamera(), null, { treeId: true });
    expect(Object.keys(input.pass.getMRT()!.outputNodes)).toEqual(['output', TREE_MASK, TREE_ID]);
    expect(input.treeId?.value).toBe(input.pass.getTexture(TREE_ID));
  });

  it('renders the scene pass without MSAA only with the Tree ID channel (an integer target cannot be multisampled)', () => {
    const plain = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'stylized' });
    expect(plain.scenePass.pass.options.samples).toBeUndefined();
    const lowPoly = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'low-poly' });
    expect(lowPoly.scenePass.pass.options.samples).toBe(0);
    expect(treeEffectsPass(new Scene(), new PerspectiveCamera(), null, { treeId: true }).pass.options.samples).toBe(0);
  });

  it('keeps the MRT when set() needs the same channels', () => {
    for (const treeId of [false, true]) {
      const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'realistic', treeId });
      const scenePass = effects.scenePass;
      const before = scenePass.pass.getMRT();
      effects.set(null);
      effects.set({ grade: {}, outline: { thickness: 3 } });
      effects.set({ glow: { radius: 2 } });
      expect(effects.scenePass).toBe(scenePass);
      expect(effects.scenePass.pass.getMRT()).toBe(before);
    }
  });

  it('adds the Tree ID channel for outline.betweenTrees, and toggling it rebuilds the graph', () => {
    const outline = { color: '#18230f', thickness: 2 };
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: { outline } });
    const plain = effects.pipeline.outputNode;
    effects.set({ outline: { ...outline, betweenTrees: true } });
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK, TREE_ID]);
    const between = effects.pipeline.outputNode;
    expect(between).not.toBe(plain);
    // Other colours and numbers with betweenTrees still on: the same graph.
    effects.set({ outline: { color: '#ff00ff', thickness: 3, strength: 0.5, betweenTrees: true } });
    expect(effects.pipeline.outputNode).toBe(between);
    effects.set({ outline: { ...outline, betweenTrees: false } });
    expect(outputsOf(effects)).toEqual(['output', TREE_MASK]);
    expect(effects.pipeline.outputNode).not.toBe(between);
  });

  it('rebuilds the graph for betweenTrees even when the Tree ID channel stays on (treeId: true)', () => {
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: { outline: {} }, treeId: true });
    const scenePass = effects.scenePass;
    const plain = effects.pipeline.outputNode;
    effects.set({ outline: { betweenTrees: true } });
    expect(effects.scenePass).toBe(scenePass);
    expect(effects.pipeline.outputNode).not.toBe(plain);
  });

  it('gives the effects the depth of the scene pass, and betweenTrees needs it and the Tree ID', () => {
    const input = treeEffectsPass(new Scene(), new PerspectiveCamera());
    expect(input.depth?.value).toBe(input.pass.getTexture('depth'));
    expect(() => treeOutline(input, { betweenTrees: true })).toThrow(/treeId/);
    expect(() => applyTreeEffects({ color: input.color, mask: input.mask }, { outline: { betweenTrees: true } })).toThrow(/treeId/);
    const withId = treeEffectsPass(new Scene(), new PerspectiveCamera(), null, { treeId: true });
    expect(treeOutline(withId, { betweenTrees: true })).not.toBe(withId.color);
    expect(() => treeOutline({ ...withId, depth: undefined }, { betweenTrees: true })).toThrow(/depth/);
  });

  it('pick() throws without the Tree ID channel, naming the treeId option', () => {
    const effects = createTreeEffects(renderer, new Scene(), new PerspectiveCamera(), { effects: 'stylized' });
    expect(() => effects.pick(0, 0)).toThrow(/treeId/);
  });
});

/** Every node in a graph that passes `test`. */
function findNodes(root: Node, test: (node: Node) => boolean): Node[] {
  const seen = new Set<Node>();
  const found: Node[] = [];
  const visit = (node: Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (test(node)) found.push(node);
    for (const child of node.getChildren()) visit(child as Node);
  };
  visit(root);
  return found;
}

describe('/effects packaging', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  it('is published as the @casmo/tree.js/effects subpath and not pulled in by the core entry', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.exports['./effects']).toEqual({ types: './dist/effects/index.d.ts', import: './dist/effects.js' });
    expect(read('src/index.ts')).not.toMatch(/\.\/effects/);
  });
});
