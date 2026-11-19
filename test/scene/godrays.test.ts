import { afterEach, describe, expect, it, vi } from 'vitest';
import { texture, vec4 } from 'three/tsl';
import { DepthTexture, DirectionalLight, PerspectiveCamera, PointLight, Scene, SpotLight, type Light, type Node, type Renderer } from 'three/webgpu';
import { createScenePipeline, sceneGodrays, SUGGESTED_SCENE_EFFECTS, type ScenePipelineOptions } from '../../src/scene';

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const create = (options?: ScenePipelineOptions) => createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), options);
const shadowSun = () => Object.assign(new DirectionalLight(), { castShadow: true });
const godraysIn = (root: Node) => findNodes(root, (node) => node.constructor.name === 'GodraysNode');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SUGGESTED_SCENE_EFFECTS: god rays', () => {
  it('suggests god rays for realistic only', () => {
    expect(SUGGESTED_SCENE_EFFECTS.realistic.godrays).toBeDefined();
    expect(SUGGESTED_SCENE_EFFECTS.stylized.godrays).toBeUndefined();
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].godrays).toBeUndefined();
  });
});

describe('ScenePipeline: god rays need a shadow-casting sun', () => {
  it('runs god rays with a shadow-casting directional or point sun', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const sun of [shadowSun(), Object.assign(new PointLight(), { castShadow: true })]) {
      const pipeline = create({ sceneEffects: { godrays: {} }, sun });
      expect(godraysIn(pipeline.pipeline.outputNode)).toHaveLength(1);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  const unusable: [string, Light | undefined][] = [
    ['missing', undefined],
    ['not casting shadows', new DirectionalLight()],
    ['a spot light', Object.assign(new SpotLight(), { castShadow: true })],
  ];
  for (const [name, sun] of unusable) {
    it(`skips god rays with exactly one console warning when the sun is ${name}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const pipeline = create({ sceneEffects: { godrays: {}, toneMapping: {} }, sun });
      expect(godraysIn(pipeline.pipeline.outputNode)).toHaveLength(0);
      // Rebuilds and updates do not warn again.
      pipeline.set({ sceneEffects: { godrays: { density: 3 } } });
      pipeline.set({ sceneEffects: { godrays: {}, toneMapping: { mapping: 'neutral' } } });
      pipeline.set({ style: 'realistic' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/god rays/i);
    });
  }

  it('never changes the sun or turns shadows on', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sun = new DirectionalLight();
    const shadowMap = { enabled: false };
    const fake = { isWebGPURenderer: true, shadowMap } as unknown as Renderer;
    const pipeline = createScenePipeline(fake, new Scene(), new PerspectiveCamera(), { style: 'realistic', sun });
    pipeline.dispose();
    expect(sun.castShadow).toBe(false);
    expect(shadowMap).toEqual({ enabled: false });
  });

  it('keeps the graph when only god ray numbers change, and frees the god rays on a rebuild', () => {
    const pipeline = create({ sceneEffects: { godrays: {} }, sun: shadowSun() });
    const before = pipeline.pipeline.outputNode;
    const [rays] = godraysIn(before);
    const disposed = vi.fn();
    rays!.addEventListener('dispose', disposed);
    pipeline.set({ sceneEffects: { godrays: { density: 4, color: '#ffffff' } } });
    expect(pipeline.pipeline.outputNode).toBe(before);
    expect(disposed).not.toHaveBeenCalled();
    pipeline.set({ sceneEffects: null });
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});

describe('sceneGodrays', () => {
  it('returns a new colour node', () => {
    const color = vec4(0.2, 0.4, 0.1, 1);
    const depth = texture(new DepthTexture(1, 1));
    expect(sceneGodrays(color, depth, new PerspectiveCamera(), shadowSun())).not.toBe(color);
    expect(sceneGodrays(color, depth, new PerspectiveCamera(), shadowSun(), { density: 1, color: '#fff0c8' })).not.toBe(color);
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
