import {
  createContext,
  use,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Light, Object3D, Renderer } from 'three/webgpu';
// Types only: the Scene Pipeline module (and its three addons) is loaded with a dynamic import the
// first time a <ScenePipeline> renders, so apps that never use it don't bundle it.
import type { ScenePipeline as ScenePipelineObject, ScenePipelineChoice } from '../scene';
import type { CustomTreeEffect } from '../effects';
import type { ForestTree } from '../forest';
import type { Tree } from '../tree';

type SceneModule = typeof import('../scene');

let sceneModule: Promise<SceneModule> | undefined;

/** The `@casmo/tree.js/scene` module, loaded once (a failed load is retried on the next render). */
function sceneResource(): Promise<SceneModule> {
  if (!sceneModule) {
    sceneModule = import('../scene');
    sceneModule.catch(() => (sceneModule = undefined));
  }
  return sceneModule;
}

/** Starts loading the Scene Pipeline module ahead of time, without suspending. */
export function preloadScenePipeline(): void {
  void sceneResource().catch(() => {});
}

export interface ScenePipelineProps extends ScenePipelineChoice {
  /** A shadow-casting light for god rays, or a ref to one (e.g. a JSX `<directionalLight ref={sun}>`). Never changed. */
  sun?: Light | RefObject<Light | null>;
  /** The trees to outline. Default: every tree. A new array rebuilds the pipeline. */
  selection?: Object3D[];
  /** Keeps the Tree ID channel on, for `pick()`. */
  treeId?: boolean;
  /** The trees the Highlight marks (no rebuild when it changes). */
  highlighted?: (Tree | ForestTree)[];
  /** Keeps the Wind-aware velocity channel on (`scenePass.velocity`). */
  velocity?: boolean;
  /** Receives the tree.js `ScenePipeline` (`null` until it is built and after unmount). */
  ref?: Ref<ScenePipelineObject | null>;
  /** Children can reach the pipeline with {@link useScenePipeline}. */
  children?: ReactNode;
}

const ScenePipelineContext = createContext<ScenePipelineObject | null>(null);

// Pipelines <ScenePipeline> has disposed of: a <TreeEffect> leaves those alone.
const disposedPipelines = new WeakSet<ScenePipelineObject>();

/**
 * The `ScenePipeline` of the nearest enclosing `<ScenePipeline>` (e.g. to call `pick()`), or `null`
 * outside one and before it is built (the render after it mounts).
 */
export function useScenePipeline(): ScenePipelineObject | null {
  return useContext(ScenePipelineContext);
}

const isRef = (sun: ScenePipelineProps['sun']): sun is RefObject<Light | null> => !!sun && 'current' in sun && !(sun as Partial<Light>).isLight;
const sunOf = (sun: ScenePipelineProps['sun']): Light | undefined => (isRef(sun) ? sun.current ?? undefined : sun);

/**
 * Renders the R3F scene through a Scene Pipeline (`@casmo/tree.js/scene`): the Style's suggested Tree
 * Effects and Scene Effects, or your own. Takes over rendering (`useFrame` at priority 1), follows the
 * camera, calls `set()` when `style`/`treeEffects`/`sceneEffects` change, and disposes of the pipeline
 * on unmount (which gives `scene.fogNode` back). Loads the scene module on first use: suspends.
 *
 * ```tsx
 * <Canvas><ScenePipeline style="stylized" sun={sun} />...</Canvas>
 * ```
 */
export function ScenePipeline({ style, treeEffects, sceneEffects, sun, selection, treeId, highlighted, velocity, ref, children }: ScenePipelineProps) {
  const { createScenePipeline } = use(sceneResource());
  const gl = useThree((s) => s.gl) as unknown as Renderer;
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [pipeline, setPipeline] = useState<ScenePipelineObject | null>(null);
  // The light the pipeline was built with; a `sun` ref that points elsewhere later rebuilds it.
  const builtSun = useRef<Light | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  // The choice the pipeline has (it is built with the latest one; later changes go through set()).
  const applied = useRef('');

  const choice: ScenePipelineChoice = { style, treeEffects, sceneEffects };
  const choiceKey = JSON.stringify(choice);
  const latest = useRef({ choice, highlighted });
  latest.current = { choice, highlighted };

  // A passive effect: refs (a JSX `sun`) are all attached by then.
  useEffect(() => {
    const light = sunOf(sun);
    builtSun.current = light;
    applied.current = JSON.stringify(latest.current.choice);
    const created = createScenePipeline(gl, scene, camera, {
      ...latest.current.choice,
      sun: light,
      selection,
      treeId,
      velocity,
      highlighted: [...(latest.current.highlighted ?? [])],
    });
    setPipeline(created);
    return () => {
      disposedPipelines.add(created);
      created.dispose();
      setPipeline(null);
    };
    // generation: a `sun` ref that now points at another light (see useFrame).
  }, [createScenePipeline, gl, scene, camera, sun, generation, selection, treeId, velocity]);

  useLayoutEffect(() => {
    if (!pipeline || applied.current === choiceKey) return;
    applied.current = choiceKey;
    pipeline.set(latest.current.choice);
  }, [pipeline, choiceKey]);

  useLayoutEffect(() => {
    pipeline?.highlighted.splice(0, Infinity, ...(highlighted ?? []));
  }, [pipeline, highlighted]);

  useImperativeHandle(ref, () => pipeline!, [pipeline]);

  useFrame((state) => {
    if (isRef(sun) && sunOf(sun) !== builtSun.current) {
      builtSun.current = sunOf(sun);
      setGeneration((g) => g + 1);
    }
    if (pipeline) pipeline.render();
    else state.gl.render(state.scene, state.camera);
  }, 1);

  return <ScenePipelineContext value={pipeline}>{children}</ScenePipelineContext>;
}

export interface TreeEffectProps<Options> {
  /**
   * The app's own Tree Effect (`CustomTreeEffect` from `@casmo/tree.js/effects`). Keep it stable (module
   * scope or `useMemo`): another effect object is removed and added again (a new graph).
   */
  effect: CustomTreeEffect<Options>;
  /** Its options. Compared by value: new options go through the effect's `update()` (no new graph, no recompile). */
  options?: Options;
}

/**
 * Adds a custom Tree Effect to the enclosing `<ScenePipeline>` while mounted (`pipeline.addEffect`), at
 * the place its `before` names (`'end'`: after the Highlight); several at the same place run in the order they mounted. New `options`
 * only call `updateEffect`, it stays through Style and settings changes and goes into a rebuilt pipeline,
 * and it is removed on unmount. Renders nothing; does nothing outside a `<ScenePipeline>`.
 *
 * ```tsx
 * <ScenePipeline style="stylized">
 *   <TreeEffect effect={foliage} options={{ strength: 0.5 }} />
 * </ScenePipeline>
 * ```
 */
export function TreeEffect<Options>({ effect, options }: TreeEffectProps<Options>): null {
  const pipeline = useScenePipeline();
  const latest = useRef(options);
  latest.current = options;
  // The options the effect was added or last updated with, by value.
  const applied = useRef('');
  const optionsKey = JSON.stringify(options) ?? '';

  useLayoutEffect(() => {
    if (!pipeline) return;
    applied.current = JSON.stringify(latest.current) ?? '';
    pipeline.addEffect(effect, latest.current as Options);
    return () => {
      if (!disposedPipelines.has(pipeline)) pipeline.removeEffect(effect);
    };
  }, [pipeline, effect]);

  useLayoutEffect(() => {
    if (!pipeline || applied.current === optionsKey) return;
    applied.current = optionsKey;
    pipeline.updateEffect(effect, latest.current as Options);
  }, [pipeline, effect, optionsKey]);

  return null;
}
