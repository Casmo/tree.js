import { describe, expect, it, vi } from 'vitest';
import { vec4 } from 'three/tsl';
import { PerspectiveCamera, Scene, type Node, type Renderer } from 'three/webgpu';
import { applySceneEffects, createScenePipeline, sceneAntialias, SUGGESTED_SCENE_EFFECTS, WIND_VELOCITY, type ScenePipelineOptions } from '../../src/scene';

// SMAA loads its lookup textures through `new Image()`, which Node does not have.
vi.stubGlobal('Image', class {
  src = '';
});

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const create = (options?: ScenePipelineOptions) => createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), options);
const isTRAA = (node: Node) => node.constructor.name === 'TRAANode' || node.constructor.name === 'WindTRAANode';

describe('TRAA anti-aliasing', () => {
  it('adds the Wind-aware velocity channel (a new scene pass) when selected, and removes it when switched away', () => {
    const pipeline = create({ sceneEffects: { antialias: 'smaa' } });
    const smaa = pipeline.scenePass;
    expect(smaa.velocity).toBeUndefined();
    pipeline.set({ sceneEffects: { antialias: 'traa' } });
    expect(pipeline.scenePass).not.toBe(smaa);
    expect(Object.keys(pipeline.scenePass.pass.getMRT()!.outputNodes)).toContain(WIND_VELOCITY);
    expect(pipeline.scenePass.velocity).toBeDefined();
    pipeline.set({ sceneEffects: { antialias: 'fxaa' } });
    expect(pipeline.scenePass.velocity).toBeUndefined();
    expect(Object.keys(pipeline.scenePass.pass.getMRT()?.outputNodes ?? {})).not.toContain(WIND_VELOCITY);
  });

  it('runs before tone mapping on the scene pass colour, depth and velocity', () => {
    const pipeline = create({ sceneEffects: { toneMapping: {}, antialias: 'traa' } });
    const output = pipeline.pipeline.outputNode;
    expect(isTRAA(output), 'tone mapping comes last').toBe(false);
    const [traa] = findNodes(output, isTRAA) as unknown as [{ depthNode: Node; velocityNode: Node }];
    expect(traa).toBeDefined();
    expect(traa.depthNode).toBe(pipeline.scenePass.depth);
    expect(traa.velocityNode).toBe(pipeline.scenePass.velocity);
    expect(pipeline.pipeline.outputColorTransform).toBe(false);
  });

  it('without tone mapping, the renderer\'s own output transform follows (TRAA works on linear colours)', () => {
    const pipeline = create({ sceneEffects: { antialias: 'traa' } });
    expect(isTRAA(pipeline.pipeline.outputNode)).toBe(true);
    expect(pipeline.pipeline.outputColorTransform).toBe(true);
  });

  it('frees its render targets on a switch and on dispose()', () => {
    const pipeline = create({ sceneEffects: { antialias: 'traa' } });
    const disposed = vi.fn();
    for (const node of findNodes(pipeline.pipeline.outputNode, isTRAA)) node.addEventListener('dispose', disposed);
    pipeline.set({ sceneEffects: { antialias: 'traa', toneMapping: {} } }); // a rebuild: tone mapping added
    expect(disposed).toHaveBeenCalledTimes(1);
    for (const node of findNodes(pipeline.pipeline.outputNode, isTRAA)) node.addEventListener('dispose', disposed);
    pipeline.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
  });

  it('turns MSAA off on the scene pass while it is on (it copies the depth), and back when switched off', () => {
    const pipeline = create({ velocity: true, sceneEffects: { antialias: 'smaa' } });
    const samples = pipeline.scenePass.pass.options.samples;
    pipeline.set({ sceneEffects: { antialias: 'traa' } });
    expect(pipeline.scenePass.pass.options.samples).toBe(0);
    pipeline.set({ sceneEffects: { antialias: 'smaa' } });
    expect(pipeline.scenePass.pass.options.samples).toBe(samples);
  });

  it('sceneAntialias(color, "traa", input) takes depth, velocity and camera from input, and says what is missing', () => {
    const pipeline = create({ velocity: true });
    const { color, depth, velocity } = pipeline.scenePass;
    const camera = new PerspectiveCamera();
    expect(isTRAA(sceneAntialias(color, 'traa', { depth, velocity, camera }))).toBe(true);
    expect(() => sceneAntialias(color, 'traa', { depth, camera })).toThrow(/velocity/);
    expect(() => sceneAntialias(color, 'traa', { velocity, camera })).toThrow(/depth/);
    expect(() => sceneAntialias(color, 'traa', { depth, velocity })).toThrow(/camera/);
    expect(() => sceneAntialias(color, 'traa')).toThrow(/traa/i);
    expect(() => applySceneEffects({ color: vec4(0.2, 0.4, 0.1, 1) }, { antialias: 'traa' })).toThrow(/velocity/);
  });

  it('is never suggested', () => {
    for (const settings of Object.values(SUGGESTED_SCENE_EFFECTS)) expect(settings.antialias).not.toBe('traa');
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
