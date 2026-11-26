import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { vec4 } from 'three/tsl';
import { PassNode, PerspectiveCamera, Scene, type Node, type Renderer } from 'three/webgpu';
import GTAONode from 'three/addons/tsl/display/GTAONode.js';
import { SUGGESTED_TREE_EFFECTS, TREE_ID, TREE_MASK } from '../../src/effects';
import {
  applySceneEffects,
  createScenePipeline,
  sceneAO,
  sceneAntialias,
  sceneBloom,
  sceneToneMapping,
  SUGGESTED_SCENE_EFFECTS,
  type ScenePipeline,
  type ScenePipelineOptions,
} from '../../src/scene';

// SMAA loads its lookup textures through `new Image()`, which Node does not have.
vi.stubGlobal('Image', class {
  src = '';
});

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const create = (options?: ScenePipelineOptions) => createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), options);
const outputsOf = (pipeline: ScenePipeline) => Object.keys(pipeline.scenePass.pass.getMRT()!.outputNodes);

describe('SUGGESTED_SCENE_EFFECTS', () => {
  it('suggests Neutral tone mapping for low-poly, AgX for stylized and realistic, and none for painterly (its own colours)', () => {
    expect(Object.keys(SUGGESTED_SCENE_EFFECTS).sort()).toEqual(['low-poly', 'painterly', 'realistic', 'stylized', 'whimsical']);
    expect(SUGGESTED_SCENE_EFFECTS.painterly.toneMapping).toBeUndefined();
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].toneMapping?.mapping).toBe('neutral');
    expect(SUGGESTED_SCENE_EFFECTS.stylized.toneMapping?.mapping).toBe('agx');
    expect(SUGGESTED_SCENE_EFFECTS.realistic.toneMapping?.mapping).toBe('agx');
  });

  it('suggests SMAA for every Style (the Tree ID channel turns MSAA off)', () => {
    for (const settings of Object.values(SUGGESTED_SCENE_EFFECTS)) expect(settings.antialias).toBe('smaa');
  });

  it('suggests soft bloom for stylized, subtle bloom for realistic and none for low-poly', () => {
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].bloom).toBeUndefined();
    const soft = SUGGESTED_SCENE_EFFECTS.stylized.bloom!;
    const subtle = SUGGESTED_SCENE_EFFECTS.realistic.bloom!;
    expect(soft).toBeDefined();
    expect(subtle).toBeDefined();
    expect(subtle.strength!).toBeLessThan(soft.strength!);
  });

  it('suggests exactly the spec\'s Scene Effects per Style, with light GTAO for low-poly', () => {
    const parts = (style: keyof typeof SUGGESTED_SCENE_EFFECTS) => Object.keys(SUGGESTED_SCENE_EFFECTS[style]).sort();
    expect(parts('low-poly')).toEqual(['antialias', 'ao', 'fog', 'toneMapping']);
    expect(parts('stylized')).toEqual(['antialias', 'ao', 'bloom', 'fog', 'toneMapping']);
    expect(parts('realistic')).toEqual(['antialias', 'ao', 'bloom', 'fog', 'godrays', 'toneMapping']);
    // Painterly needs no post (ADR 0014): no tone mapping curve and no bloom, only ground contact, SMAA and fog.
    expect(parts('painterly')).toEqual(['antialias', 'ao', 'fog']);
    // Whimsical: AgX, light AO, pastel fog and almost no bloom.
    expect(parts('whimsical')).toEqual(['antialias', 'ao', 'bloom', 'fog', 'toneMapping']);
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].ao!.scale!).toBeLessThan(SUGGESTED_SCENE_EFFECTS.stylized.ao!.scale!);
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

  it('renders with renderer.render() itself when the settings only turn things off (null parts add nothing)', () => {
    const render = vi.fn();
    const fake = { isWebGPURenderer: true, render } as unknown as Renderer;
    const pipeline = createScenePipeline(fake, new Scene(), new PerspectiveCamera(), { sceneEffects: { antialias: null } });
    const pipelineRender = vi.spyOn(pipeline.pipeline, 'render').mockImplementation(() => {});
    pipeline.render();
    pipeline.set({ style: 'stylized' });
    pipeline.set({ treeEffects: {}, sceneEffects: { antialias: null, bloom: undefined } });
    pipeline.render();
    expect(render).toHaveBeenCalledTimes(2);
    expect(pipelineRender).not.toHaveBeenCalled();
  });

  it('picks both the suggested Tree Effects and the suggested Scene Effects of a Style', () => {
    for (const style of ['low-poly', 'stylized', 'realistic', 'painterly', 'whimsical'] as const) {
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
    pipeline.set({ treeEffects: 'stylized', sceneEffects: { ...SUGGESTED_SCENE_EFFECTS.stylized, toneMapping: { mapping: 'agx', exposure: 1.6 } } });
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

  it('updates bloom numbers as uniforms and frees the bloom render targets when bloom goes off', () => {
    const pipeline = create({ treeEffects: null, sceneEffects: { bloom: { strength: 0.3 } } });
    const before = pipeline.pipeline.outputNode;
    const blooms = findNodes(before, (node) => node.constructor.name === 'BloomNode');
    expect(blooms).toHaveLength(1);
    const disposed = vi.fn();
    blooms[0]!.addEventListener('dispose', disposed);
    pipeline.set({ treeEffects: null, sceneEffects: { bloom: { strength: 0.8, radius: 0.6, threshold: 0.5 } } });
    expect(pipeline.pipeline.outputNode).toBe(before);
    expect(disposed).not.toHaveBeenCalled();
    pipeline.set({ treeEffects: null, sceneEffects: {} });
    expect(disposed).toHaveBeenCalledTimes(1);
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

describe('ScenePipeline anti-aliasing', () => {
  const isAA = (node: Node) => ['SMAANode', 'FXAANode'].includes(node.constructor.name);

  it('switches between SMAA, FXAA and none with set(), freeing the render targets of the old one', () => {
    const pipeline = create({ sceneEffects: { antialias: 'smaa' } });
    const smaa = findNodes(pipeline.pipeline.outputNode, isAA);
    expect(smaa.map((node) => node.constructor.name)).toEqual(['SMAANode']);
    const disposed = vi.fn();
    for (const node of findNodes(pipeline.pipeline.outputNode, (node) => 'isRTTNode' in node || isAA(node))) node.addEventListener('dispose', disposed);
    pipeline.set({ sceneEffects: { antialias: 'smaa' } });
    expect(disposed).not.toHaveBeenCalled();
    pipeline.set({ sceneEffects: { antialias: 'fxaa' } });
    expect(disposed).toHaveBeenCalledTimes(2); // the SMAA node and the texture of its input
    expect(findNodes(pipeline.pipeline.outputNode, isAA).map((node) => node.constructor.name)).toEqual(['FXAANode']);
    pipeline.set({ sceneEffects: { antialias: null } });
    expect(pipeline.pipeline.outputNode).toBe(pipeline.scenePass.color);
  });

  it('runs on display colours: last in the stack, with its own output transform when there is no tone mapping', () => {
    for (const toneMapping of [undefined, {}]) {
      const pipeline = create({ sceneEffects: { toneMapping, antialias: 'fxaa' } });
      expect(isAA(pipeline.pipeline.outputNode)).toBe(true);
      expect(pipeline.pipeline.outputColorTransform).toBe(false);
      expect(findNodes(pipeline.pipeline.outputNode, (node) => 'isRenderOutputNode' in node)).toHaveLength(1);
    }
  });

  it('dispose() frees the anti-aliasing render targets', () => {
    const pipeline = create({ sceneEffects: 'stylized' });
    const disposed = vi.fn();
    const nodes = findNodes(pipeline.pipeline.outputNode, (node) => 'isRTTNode' in node || isAA(node));
    expect(nodes.length).toBe(2);
    for (const node of nodes) node.addEventListener('dispose', disposed);
    pipeline.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
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
    expect(applySceneEffects(input, { bloom: {} })).not.toBe(input.color);
  });

  it('sceneBloom returns a new colour node, with or without options', () => {
    const color = vec4(2, 1, 0.5, 1);
    expect(sceneBloom(color)).not.toBe(color);
    expect(sceneBloom(color, { strength: 0.5, radius: 0.4, threshold: 0.9 })).not.toBe(color);
  });

  it('applySceneEffects and sceneAntialias anti-alias the colour with SMAA or FXAA', () => {
    const input = { color: vec4(0.2, 0.4, 0.1, 1) };
    expect(applySceneEffects(input, { antialias: 'smaa' }).constructor.name).toBe('SMAANode');
    expect(applySceneEffects(input, { antialias: null })).toBe(input.color);
    expect(sceneAntialias(input.color, 'smaa').constructor.name).toBe('SMAANode');
    expect(sceneAntialias(input.color, 'fxaa').constructor.name).toBe('FXAANode');
    expect(() => sceneAntialias(input.color, 'msaa' as never)).toThrow(/msaa/);
  });

  it('sceneToneMapping returns a new colour node', () => {
    const color = vec4(2, 1, 0.5, 1);
    expect(sceneToneMapping(color)).not.toBe(color);
    expect(sceneToneMapping(color, { mapping: 'neutral', exposure: 0.8 })).not.toBe(color);
  });
});

describe('ambient occlusion (GTAO through the lighting context)', () => {
  it('sceneAO returns a depth + view-normal pre-pass, the AO node and a lighting context for your own scene pass', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const { prePass, node, context } = sceneAO(scene, camera, { radius: 0.8, scale: 1.4 });
    expect(prePass).toBeInstanceOf(PassNode);
    expect(prePass.scene).toBe(scene);
    expect(Object.keys(prePass.getMRT()!.outputNodes)).toEqual(['output']);
    expect(node).toBeInstanceOf(GTAONode);
    expect(node.radius.value).toBe(0.8);
    expect(node.scale.value).toBe(1.4);
    expect(typeof (context.value as { getAO?: unknown }).getAO).toBe('function');
    // Defaults for every option.
    expect(sceneAO(scene, camera).node.radius.value).toBeGreaterThan(0);
  });

  it('is in every Style\'s suggestion, lighter for low-poly', () => {
    for (const style of ['low-poly', 'stylized', 'realistic', 'painterly'] as const) expect(SUGGESTED_SCENE_EFFECTS[style].ao, style).toBeDefined();
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].ao!.scale!).toBeLessThan(SUGGESTED_SCENE_EFFECTS.stylized.ao!.scale!);
  });

  it('feeds the AO context into the scene pass lighting only while AO is on', () => {
    const pipeline = create({ sceneEffects: { ao: {} } });
    expect(pipeline.scenePass.pass.contextNode).not.toBeNull();
    pipeline.set({ sceneEffects: null });
    expect(pipeline.scenePass.pass.contextNode).toBeNull();
    expect(create({ style: 'stylized', sceneEffects: { toneMapping: {} } }).scenePass.pass.contextNode).toBeNull();
  });

  it('rebuilds when AO is switched, and only updates uniforms when its numbers change', () => {
    const disposed = vi.spyOn(GTAONode.prototype, 'dispose');
    const pipeline = create({ sceneEffects: { ao: { radius: 1 } } });
    const context = pipeline.scenePass.pass.contextNode;
    const output = pipeline.pipeline.outputNode;
    pipeline.set({ sceneEffects: { ao: { radius: 2, scale: 0.5 } } });
    expect(pipeline.scenePass.pass.contextNode).toBe(context);
    expect(pipeline.pipeline.outputNode).toBe(output);
    expect(disposed).not.toHaveBeenCalled();
    pipeline.set({ sceneEffects: { toneMapping: {} } });
    expect(disposed).toHaveBeenCalledTimes(1);
    pipeline.set({ sceneEffects: { ao: {} } });
    expect(pipeline.scenePass.pass.contextNode).not.toBe(context);
    pipeline.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
    disposed.mockRestore();
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
