import { describe, expect, it, vi } from 'vitest';
import { texture, vec4 } from 'three/tsl';
import { DataTexture, PerspectiveCamera, RTTNode, Scene, type Renderer } from 'three/webgpu';
import { applySceneEffects, createScenePipeline, sceneMotionBlur, SUGGESTED_SCENE_EFFECTS, WIND_VELOCITY } from '../../src/scene';

// SMAA (in the suggestions) loads its lookup textures through `new Image()`, which Node does not have.
vi.stubGlobal('Image', class {
  src = '';
});

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const velocityTexture = () => texture(new DataTexture(new Float32Array(4), 1, 1));
const outputsOf = (pipeline: ReturnType<typeof createScenePipeline>) => Object.keys(pipeline.scenePass.pass.getMRT()!.outputNodes);

describe('sceneMotionBlur', () => {
  it('returns a new colour node, with or without options', () => {
    const color = vec4(0.2, 0.4, 0.1, 1);
    expect(sceneMotionBlur(color, velocityTexture())).not.toBe(color);
    expect(sceneMotionBlur(color, velocityTexture(), { strength: 2, samples: 8 })).not.toBe(color);
  });

  it('throws a clear error without a velocity channel', () => {
    expect(() => sceneMotionBlur(vec4(0, 0, 0, 1), undefined as never)).toThrow(/velocity/);
  });

  it('is a step of applySceneEffects that reads input.velocity', () => {
    const color = vec4(0.2, 0.4, 0.1, 1);
    expect(applySceneEffects({ color, velocity: velocityTexture() }, { motionBlur: {} })).not.toBe(color);
    expect(() => applySceneEffects({ color }, { motionBlur: {} })).toThrow(/velocity/);
  });

  it('is never suggested', () => {
    for (const settings of Object.values(SUGGESTED_SCENE_EFFECTS)) expect(settings).not.toHaveProperty('motionBlur');
  });
});

describe('ScenePipeline: motion blur', () => {
  const create = () => createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), { style: 'realistic' });

  it('requests the Wind-aware velocity channel while motion blur is on, and drops it when it goes off', () => {
    const pipeline = create();
    expect(outputsOf(pipeline)).not.toContain(WIND_VELOCITY);
    pipeline.set({ treeEffects: 'realistic', sceneEffects: { ...SUGGESTED_SCENE_EFFECTS.realistic, motionBlur: {} } });
    expect(outputsOf(pipeline)).toContain(WIND_VELOCITY);
    expect(pipeline.scenePass.velocity).toBeDefined();
    pipeline.set({ style: 'realistic' });
    expect(outputsOf(pipeline)).not.toContain(WIND_VELOCITY);
  });

  it('only updates uniforms when its numbers change, and frees its render target on a rebuild and on dispose()', () => {
    // After the Tree Effects, the colour so far is rendered to a texture (an RTT node) to sample along the motion.
    const disposed = vi.spyOn(RTTNode.prototype, 'dispose');
    const pipeline = createScenePipeline(renderer, new Scene(), new PerspectiveCamera(), { treeEffects: 'realistic', sceneEffects: { motionBlur: {} } });
    const graph = pipeline.pipeline.outputNode;
    pipeline.set({ treeEffects: 'realistic', sceneEffects: { motionBlur: { strength: 2, samples: 4 } } });
    expect(pipeline.pipeline.outputNode).toBe(graph);
    expect(disposed).not.toHaveBeenCalled();
    pipeline.set({ treeEffects: 'realistic', sceneEffects: { motionBlur: {}, toneMapping: {} } });
    expect(disposed).toHaveBeenCalledTimes(1);
    pipeline.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
    disposed.mockRestore();
  });
});

