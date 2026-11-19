import type { Camera, Light, Node, TextureNode } from 'three/webgpu';
import type { SceneEffectsSettings } from './settings';

/**
 * What a colour Scene Effect reads: the colour so far, and the scene pass's depth and camera when
 * the stack runs on a scene pass (the ready-made Scene Pipeline always passes them). Later channels
 * (e.g. velocity) are added here as optional fields.
 */
export interface SceneEffectInput {
  color: Node<'vec4'>;
  depth?: TextureNode;
  camera?: Camera;
  /** The shadow-casting sun for god rays (never changed). */
  sun?: Light;
}

/**
 * A built Scene Effect whose colours and numbers are uniforms: `update()` changes them in place
 * (no new graph). `update()` gets the whole Scene Effects settings; each effect reads its own part.
 */
export interface LiveSceneEffect {
  node: Node<'vec4'>;
  update(settings: SceneEffectsSettings): void;
  /** Frees the render targets the effect owns (blur, bloom, AA...), called on a rebuild and on dispose. */
  dispose?(): void;
}

/**
 * One step of the colour stack of {@link applySceneEffects}. Each Scene Effect file exports one, and
 * `stack.ts` lists them in stack order.
 */
export interface SceneEffectStage {
  /**
   * The part of the settings that shapes this step's graph: `undefined` when the step is off,
   * otherwise a JSON-serialisable value that is equal for settings that differ only in uniforms
   * (e.g. tone mapping: the curve; the exposure is a uniform).
   */
  shape(settings: SceneEffectsSettings): unknown;
  /** Builds the step onto `input.color` (only called when `shape()` is not `undefined`). */
  build(input: SceneEffectInput, settings: SceneEffectsSettings): LiveSceneEffect;
  /**
   * The step outputs display colours (tone mapped, in the output colour space), so the
   * RenderPipeline must not apply its own output transform (`outputColorTransform = false`).
   */
  display?: boolean;
}
