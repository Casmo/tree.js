import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { float, vec4 } from 'three/tsl';
import { DirectionalLight, PerspectiveCamera, type Node, type Scene } from 'three/webgpu';
import { useThree, type RootState } from '@react-three/fiber';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { SUGGESTED_TREE_EFFECTS, type CustomTreeEffect } from '../../src/effects';
import { ScenePipeline as ScenePipelineObject, SUGGESTED_SCENE_EFFECTS } from '../../src/scene';
import { ScenePipeline, TreeEffect, useScenePipeline } from '../../src/react';

const fog = (density: number) => float(density) as unknown as Node;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// SMAA (in every suggestion) loads its lookup textures through `new Image()`, which Node does not have.
vi.stubGlobal('Image', class {
  src = '';
});

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;

/** A stand-in WebGPURenderer: enough for the pipeline to build its node graph without a GPU. */
const gl = async () => ({ render() {}, setSize() {}, setPixelRatio() {}, isWebGPURenderer: true }) as never;

let renderer: Renderer | undefined;
afterEach(async () => {
  await renderer?.unmount();
  renderer = undefined;
  vi.restoreAllMocks();
});

describe('<ScenePipeline> (React Three Fiber)', () => {
  it('builds a Scene Pipeline with the Style\'s suggestions, exposed through its ref', async () => {
    const ref = createRef<ScenePipelineObject>();
    renderer = await ReactThreeTestRenderer.create(<ScenePipeline ref={ref} style="stylized" />, { gl });
    expect(ref.current).toBeInstanceOf(ScenePipelineObject);
    expect(ref.current!.settings).toEqual({ treeEffects: SUGGESTED_TREE_EFFECTS.stylized, sceneEffects: SUGGESTED_SCENE_EFFECTS.stylized });
  });

  it('calls set() when the choice changes, keeping the same pipeline', async () => {
    const ref = createRef<ScenePipelineObject>();
    renderer = await ReactThreeTestRenderer.create(<ScenePipeline ref={ref} style="stylized" />, { gl });
    const pipeline = ref.current!;
    const set = vi.spyOn(pipeline, 'set');

    await renderer.update(<ScenePipeline ref={ref} style="stylized" />);
    expect(set).not.toHaveBeenCalled();

    await renderer.update(<ScenePipeline ref={ref} style="stylized" sceneEffects={{ toneMapping: { exposure: 2 } }} />);
    expect(ref.current).toBe(pipeline);
    expect(set).toHaveBeenCalledWith({ style: 'stylized', sceneEffects: { toneMapping: { exposure: 2 } } });
    expect(pipeline.settings.sceneEffects).toEqual({ toneMapping: { exposure: 2 } });
  });

  it('takes over rendering: each frame is drawn by the pipeline', async () => {
    const ref = createRef<ScenePipelineObject>();
    renderer = await ReactThreeTestRenderer.create(<ScenePipeline ref={ref} style="low-poly" />, { gl });
    const render = vi.spyOn(ref.current!, 'render').mockImplementation(() => {});
    await renderer.advanceFrames(3, 1 / 60);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('disposes of the pipeline on unmount, giving the app\'s scene.fogNode back', async () => {
    const ref = createRef<ScenePipelineObject>();
    const appFog = fog(0.5);
    renderer = await ReactThreeTestRenderer.create(<ScenePipeline ref={ref} style="stylized" sceneEffects={null} />, { gl });
    const scene = renderer.scene.instance as unknown as Scene;
    scene.fogNode = appFog;
    await renderer.update(<ScenePipeline ref={ref} style="stylized" />);
    expect(scene.fogNode).not.toBe(appFog);
    const dispose = vi.spyOn(ref.current!, 'dispose');

    await renderer.unmount();
    renderer = undefined;
    expect(dispose).toHaveBeenCalledOnce();
    expect(scene.fogNode).toBe(appFog);
    expect(ref.current).toBeNull();
  });

  it('builds a new pipeline for another camera', async () => {
    const ref = createRef<ScenePipelineObject>();
    let setState!: RootState['set'];
    function Store() {
      setState = useThree((s) => s.set);
      return null;
    }
    renderer = await ReactThreeTestRenderer.create(
      <>
        <Store />
        <ScenePipeline ref={ref} style="low-poly" />
      </>,
      { gl },
    );
    const before = ref.current!;
    const dispose = vi.spyOn(before, 'dispose');
    await ReactThreeTestRenderer.act(async () => setState({ camera: new PerspectiveCamera() }));
    expect(ref.current).not.toBe(before);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('gives the pipeline to its children through useScenePipeline()', async () => {
    const seen: (ScenePipelineObject | null)[] = [];
    function Probe() {
      seen.push(useScenePipeline());
      return null;
    }
    const ref = createRef<ScenePipelineObject>();
    renderer = await ReactThreeTestRenderer.create(
      <ScenePipeline ref={ref} style="low-poly" treeId>
        <Probe />
      </ScenePipeline>,
      { gl },
    );
    expect(seen.at(-1)).toBe(ref.current);
    expect(seen.at(-1)!.scenePass.treeId).toBeDefined();
  });
});

describe('<ScenePipeline sun>', () => {
  const shadowSun = () => Object.assign(new DirectionalLight(), { castShadow: true });
  /** The god rays warnings (R3F warns about THREE.Clock on its own). */
  const skipped = () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => warn.mock.calls.filter(([message]) => String(message).includes('god rays skipped'));
  };

  it('runs god rays with a shadow-casting Light', async () => {
    const warnings = skipped();
    const ref = createRef<ScenePipelineObject>();
    renderer = await ReactThreeTestRenderer.create(<ScenePipeline ref={ref} sceneEffects={{ godrays: {} }} sun={shadowSun()} />, { gl });
    expect(godraysIn(ref.current!.pipeline.outputNode)).toHaveLength(1);
    expect(warnings()).toHaveLength(0);
  });

  it('runs god rays with a ref to a JSX light', async () => {
    const warnings = skipped();
    const ref = createRef<ScenePipelineObject>();
    const sun = createRef<DirectionalLight>();
    renderer = await ReactThreeTestRenderer.create(
      <>
        <ScenePipeline ref={ref} sceneEffects={{ godrays: {} }} sun={sun} />
        <directionalLight ref={sun} castShadow />
      </>,
      { gl },
    );
    expect(godraysIn(ref.current!.pipeline.outputNode)).toHaveLength(1);
    expect(warnings()).toHaveLength(0);
  });

  it('skips god rays (one warning) without a sun', async () => {
    const warnings = skipped();
    const ref = createRef<ScenePipelineObject>();
    renderer = await ReactThreeTestRenderer.create(<ScenePipeline ref={ref} sceneEffects={{ godrays: {} }} />, { gl });
    expect(godraysIn(ref.current!.pipeline.outputNode)).toHaveLength(0);
    expect(warnings()).toHaveLength(1);
  });

  it('rebuilds when a sun ref is filled later (a light inside Suspense)', async () => {
    skipped();
    const ref = createRef<ScenePipelineObject>();
    const sun: { current: DirectionalLight | null } = { current: null };
    renderer = await ReactThreeTestRenderer.create(<ScenePipeline ref={ref} sceneEffects={{ godrays: {} }} sun={sun} />, { gl });
    expect(godraysIn(ref.current!.pipeline.outputNode)).toHaveLength(0);
    sun.current = shadowSun();
    await ReactThreeTestRenderer.act(async () => renderer!.advanceFrames(1, 1 / 60));
    expect(godraysIn(ref.current!.pipeline.outputNode)).toHaveLength(1);
  });
});

function godraysIn(root: Node): Node[] {
  const found: Node[] = [];
  const seen = new Set<Node>();
  const visit = (node: Node) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.constructor.name === 'GodraysNode') found.push(node);
    for (const child of node.getChildren()) visit(child as Node);
  };
  visit(root);
  return found;
}

describe('<TreeEffect> (a custom Tree Effect in <ScenePipeline>)', () => {
  const passThrough = (before?: CustomTreeEffect<{ strength: number }>['before']): CustomTreeEffect<{ strength: number }> & { update: ReturnType<typeof vi.fn> } => {
    const update = vi.fn();
    return { before, update, build: (input) => ({ node: vec4(input.color.rgb, input.color.a), update }) };
  };

  it('adds the effect while mounted, updates its options live and removes it again', async () => {
    const ref = createRef<ScenePipelineObject>();
    const foliage = passThrough('outline');
    renderer = await ReactThreeTestRenderer.create(
      <ScenePipeline ref={ref} style="stylized">
        <TreeEffect effect={foliage} options={{ strength: 1 }} />
      </ScenePipeline>,
      { gl },
    );
    const pipeline = ref.current!;
    expect(pipeline.customEffects).toEqual([foliage]);

    const add = vi.spyOn(pipeline, 'addEffect');
    await renderer.update(
      <ScenePipeline ref={ref} style="stylized">
        <TreeEffect effect={foliage} options={{ strength: 1 }} />
      </ScenePipeline>,
    );
    expect(foliage.update).not.toHaveBeenCalled(); // the same options by value

    await renderer.update(
      <ScenePipeline ref={ref} style="realistic">
        <TreeEffect effect={foliage} options={{ strength: 0.5 }} />
      </ScenePipeline>,
    );
    expect(foliage.update).toHaveBeenLastCalledWith({ strength: 0.5 });
    expect(add).not.toHaveBeenCalled(); // no new graph for new options, and kept through set()
    expect(pipeline.customEffects).toEqual([foliage]);

    await renderer.update(<ScenePipeline ref={ref} style="realistic" />);
    expect(ref.current).toBe(pipeline);
    expect(pipeline.customEffects).toEqual([]);
  });

  it('several run in the order they were mounted', async () => {
    const ref = createRef<ScenePipelineObject>();
    const [a, b] = [passThrough(), passThrough()];
    renderer = await ReactThreeTestRenderer.create(
      <ScenePipeline ref={ref} style="low-poly">
        <TreeEffect effect={a} options={{ strength: 1 }} />
        <TreeEffect effect={b} options={{ strength: 1 }} />
      </ScenePipeline>,
      { gl },
    );
    expect(ref.current!.customEffects).toEqual([a, b]);
  });

  it('goes into the new pipeline when the pipeline is rebuilt', async () => {
    const ref = createRef<ScenePipelineObject>();
    const foliage = passThrough();
    renderer = await ReactThreeTestRenderer.create(
      <ScenePipeline ref={ref} style="low-poly">
        <TreeEffect effect={foliage} options={{ strength: 1 }} />
      </ScenePipeline>,
      { gl },
    );
    const first = ref.current!;
    await renderer.update(
      <ScenePipeline ref={ref} style="low-poly" treeId>
        <TreeEffect effect={foliage} options={{ strength: 1 }} />
      </ScenePipeline>,
    );
    expect(ref.current).not.toBe(first);
    expect(ref.current!.customEffects).toEqual([foliage]);
  });
});
