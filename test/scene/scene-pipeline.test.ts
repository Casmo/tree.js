import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { vec4 } from 'three/tsl';
import { PerspectiveCamera, Scene, type Node, type Renderer } from 'three/webgpu';
import { SUGGESTED_TREE_EFFECTS, TREE_ID, TREE_MASK } from '../../src/effects';
import {
  applySceneEffects,
  createScenePipeline,
  sceneToneMapping,
  SUGGESTED_SCENE_EFFECTS,
  type ScenePipeline,
  type ScenePipelineOptions,
} from '../../src/scene';

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const create = (options?: ScenePipelineOptions) => createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), options);
const outputsOf = (pipeline: ScenePipeline) => Object.keys(pipeline.scenePass.pass.getMRT()!.outputNodes);

describe('SUGGESTED_SCENE_EFFECTS', () => {
  it('suggests Neutral tone mapping for low-poly and AgX for stylized and realistic', () => {
    expect(Object.keys(SUGGESTED_SCENE_EFFECTS).sort()).toEqual(['low-poly', 'realistic', 'stylized']);
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].toneMapping?.mapping).toBe('neutral');
    expect(SUGGESTED_SCENE_EFFECTS.stylized.toneMapping?.mapping).toBe('agx');
    expect(SUGGESTED_SCENE_EFFECTS.realistic.toneMapping?.mapping).toBe('agx');
  });
});

describe('ScenePipeline settings', () => {
  it('adds nothing without a style or overrides: the scene pass colour with the normal output transform', () => {
    const pipeline = create();
    expect(pipeline.settings).toEqual({ treeEffects: {}, sceneEffects: {} });
    expect(pipeline.pipeline.outputNode).toBe(pipeline.scenePass.color);
    expect(pipeline.pipeline.outputColorTransform).toBe(true);
    expect(outputsOf(pipeline)).toEqual(['output', TREE_MASK]);
  });

  it('renders with renderer.render(scene, camera) itself while nothing is on (pixel-identical by construction)', () => {
    const render = vi.fn();
    const fake = { isWebGPURenderer: true, render } as unknown as Renderer;
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const pipeline = createScenePipeline(fake, scene, camera);
    pipeline.render();
    expect(render).toHaveBeenCalledWith(scene, camera);
    pipeline.set({ style: 'stylized' });
    const pipelineRender = vi.spyOn(pipeline.pipeline, 'render').mockImplementation(() => {});
    pipeline.render();
    expect(pipelineRender).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    // The Tree ID channel (for pick()) needs the scene pass, even without effects.
    const picking = createScenePipeline(fake, scene, camera, { treeId: true });
    vi.spyOn(picking.pipeline, 'render').mockImplementation(() => {});
    picking.render();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('picks both the suggested Tree Effects and the suggested Scene Effects of a Style', () => {
    for (const style of ['low-poly', 'stylized', 'realistic'] as const) {
      const pipeline = create({ style });
      expect(pipeline.settings.treeEffects).toBe(SUGGESTED_TREE_EFFECTS[style]);
      expect(pipeline.settings.sceneEffects).toBe(SUGGESTED_SCENE_EFFECTS[style]);
      // Tone mapping and the output colour space are applied inside the pipeline.
      expect(pipeline.pipeline.outputColorTransform).toBe(false);
    }
  });

  it('replaces a whole group with treeEffects or sceneEffects: a Style name, settings or null', () => {
    const own = { toneMapping: { mapping: 'aces' as const, exposure: 1.2 } };
    expect(create({ style: 'stylized', treeEffects: null }).settings).toEqual({ treeEffects: {}, sceneEffects: SUGGESTED_SCENE_EFFECTS.stylized });
    expect(create({ style: 'stylized', sceneEffects: null }).settings).toEqual({ treeEffects: SUGGESTED_TREE_EFFECTS.stylized, sceneEffects: {} });
    const mixed = create({ style: 'realistic', treeEffects: 'low-poly', sceneEffects: own });
    expect(mixed.settings.treeEffects).toBe(SUGGESTED_TREE_EFFECTS['low-poly']);
    expect(mixed.settings.sceneEffects).toBe(own);
    // Without a style, an override is the only part that is on.
    expect(create({ sceneEffects: 'low-poly' }).settings).toEqual({ treeEffects: {}, sceneEffects: SUGGESTED_SCENE_EFFECTS['low-poly'] });
  });

  it('rejects an unknown Style', () => {
    expect(() => create({ style: 'unknown' as never })).toThrow(/unknown/);
    expect(() => create({ sceneEffects: 'unknown' as never })).toThrow(/unknown/);
  });

  it('switches with set(): a Style, or the groups, with the same rules as the options', () => {
    const pipeline = create({ style: 'low-poly' });
    pipeline.set({ style: 'stylized' });
    expect(pipeline.settings.sceneEffects).toBe(SUGGESTED_SCENE_EFFECTS.stylized);
    pipeline.set({ treeEffects: null, sceneEffects: 'realistic' });
    expect(pipeline.settings).toEqual({ treeEffects: {}, sceneEffects: SUGGESTED_SCENE_EFFECTS.realistic });
    pipeline.set({});
    expect(pipeline.settings).toEqual({ treeEffects: {}, sceneEffects: {} });
    expect(pipeline.pipeline.outputNode).toBe(pipeline.scenePass.color);
    expect(pipeline.pipeline.outputColorTransform).toBe(true);
  });
});

describe('ScenePipeline set(): rebuild versus uniform-only update', () => {
  it('keeps the graph when only colours and numbers change', () => {
    const pipeline = create({ style: 'stylized' });
    const before = pipeline.pipeline.outputNode;
    pipeline.set({ treeEffects: 'stylized', sceneEffects: { toneMapping: { mapping: 'agx', exposure: 1.6 } } });
    expect(pipeline.pipeline.outputNode).toBe(before);
    pipeline.set({ style: 'stylized' });
    expect(pipeline.pipeline.outputNode).toBe(before);
  });

  it('builds a new graph when the tone mapping curve or an effect switches', () => {
    const pipeline = create({ style: 'stylized' });
    const outputs = new Set([pipeline.pipeline.outputNode]);
    pipeline.set({ treeEffects: 'stylized', sceneEffects: { toneMapping: { mapping: 'neutral' } } });
    outputs.add(pipeline.pipeline.outputNode);
    pipeline.set({ treeEffects: 'stylized', sceneEffects: null });
    outputs.add(pipeline.pipeline.outputNode);
    expect(pipeline.pipeline.outputColorTransform).toBe(true);
    pipeline.set({ treeEffects: null, sceneEffects: null });
    outputs.add(pipeline.pipeline.outputNode);
    expect(outputs.size).toBe(4);
  });

  it('frees the render-target nodes of the old graph on a rebuild, not on an update', () => {
    const pipeline = create({ treeEffects: { glow: { radius: 4 } }, sceneEffects: 'realistic' });
    const blurs = findNodes(pipeline.pipeline.outputNode, (node) => 'isGaussianBlurNode' in node);
    expect(blurs.length).toBeGreaterThan(0);
    const disposed = vi.fn();
    for (const blur of blurs) blur.addEventListener('dispose', disposed);
    pipeline.set({ treeEffects: { glow: { radius: 4, intensity: 2 } }, sceneEffects: 'realistic' });
    expect(disposed).not.toHaveBeenCalled();
    pipeline.set({ treeEffects: { glow: { radius: 4 } }, sceneEffects: 'low-poly' });
    expect(disposed).toHaveBeenCalledTimes(blurs.length);
  });

  it('replaces the scene pass only when the set of channels changes', () => {
    const pipeline = create({ style: 'realistic' });
    const plain = pipeline.scenePass;
    pipeline.set({ style: 'realistic', sceneEffects: null });
    expect(pipeline.scenePass).toBe(plain);
    pipeline.set({ style: 'low-poly' }); // Inner Lines and lines between trees: normal and Tree ID channels
    expect(pipeline.scenePass).not.toBe(plain);
    expect(outputsOf(pipeline).sort()).toEqual(['normal', 'output', TREE_ID, TREE_MASK].sort());
    expect(pipeline.scenePass.pass.options.samples).toBe(0);
  });
});

describe('ScenePipeline: the TreeEffects surface', () => {
  it('keeps the Tree ID channel on with treeId: true, and pick() needs it', () => {
    expect(() => create({ style: 'stylized' }).pick(0, 0)).toThrow(/treeId/);
    expect(outputsOf(create({ style: 'realistic', treeId: true }))).toEqual(['output', TREE_MASK, TREE_ID]);
  });

  it('shares the highlighted list it was given, or starts an empty one', () => {
    const highlighted: never[] = [];
    expect(create({ highlighted }).highlighted).toBe(highlighted);
    expect(create().highlighted).toEqual([]);
  });
});

describe('Scene Effects as nodes', () => {
  it('applySceneEffects leaves the colour untouched without Scene Effects', () => {
    const input = { color: vec4(0.2, 0.4, 0.1, 1) };
    expect(applySceneEffects(input, {})).toBe(input.color);
    expect(applySceneEffects(input, { toneMapping: {} })).not.toBe(input.color);
  });

  it('sceneToneMapping returns a new colour node', () => {
    const color = vec4(2, 1, 0.5, 1);
    expect(sceneToneMapping(color)).not.toBe(color);
    expect(sceneToneMapping(color, { mapping: 'neutral', exposure: 0.8 })).not.toBe(color);
  });
});

describe('/scene packaging', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  it('is published as the @casmo/tree.js/scene subpath, built as its own chunk', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.exports['./scene']).toEqual({ types: './dist/scene/index.d.ts', import: './dist/scene.js' });
    expect(read('vite.config.ts')).toMatch(/scene: resolve\(import\.meta\.dirname, 'src\/scene\/index\.ts'\)/);
  });

  it('is pulled in by neither the core entry nor /effects', async () => {
    const { readdirSync } = await import('node:fs');
    expect(read('src/index.ts')).not.toMatch(/\.\/scene/);
    for (const file of readdirSync(new URL('../../src/effects', import.meta.url))) {
      expect(read(`src/effects/${file}`), file).not.toMatch(/from '\.\.\/scene/);
    }
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
