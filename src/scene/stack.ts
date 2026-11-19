import type { Node } from 'three/webgpu';
import type { SceneEffectsSettings } from './settings';
import type { LiveSceneEffect, SceneEffectInput, SceneEffectStage } from './stage';
import { antialiasStage } from './antialias';
import { toneMappingStage } from './tone-mapping';

/**
 * The colour steps of the Scene Effects, in stack order. Fog (in the materials) and ambient
 * occlusion (in the scene pass's lighting) are not colour steps; the Tree Effects come before all
 * of these. Order: god rays -> motion blur -> bloom -> (TRAA) -> tone mapping + output colour
 * space -> SMAA / FXAA.
 */
const STACK: readonly SceneEffectStage[] = [
  // god rays
  // motion blur
  // bloom
  // TRAA (before tone mapping)
  toneMappingStage,
  antialiasStage, // SMAA / FXAA (on display colours)
];

/**
 * The shape of a combination: equal for settings whose graphs are the same (that differ only in
 * uniforms).
 */
export function sceneEffectsShape(settings: SceneEffectsSettings): string {
  return JSON.stringify(STACK.map((stage) => stage.shape(settings) ?? null));
}

/** The built stack: its colour node, whether that is display colours, `update()` and `dispose()`. */
export interface LiveSceneEffects extends Required<LiveSceneEffect> {
  /** The output is display colours (tone mapped, output colour space): no further output transform. */
  display: boolean;
}

/** {@link applySceneEffects} with every colour and number as a uniform; `update()` needs the same shape. */
export function liveSceneEffects(input: SceneEffectInput, settings: SceneEffectsSettings): LiveSceneEffects {
  const built: LiveSceneEffect[] = [];
  let color = input.color;
  let display = false;
  for (const stage of STACK) {
    if (stage.shape(settings) === undefined) continue;
    const live = stage.build({ ...input, color }, settings);
    built.push(live);
    color = live.node;
    display ||= stage.display === true;
  }
  return {
    node: color,
    display,
    update: (s) => built.forEach((live) => live.update(s)),
    dispose: () => built.forEach((live) => live.dispose?.()),
  };
}

/**
 * Applies a combination of Scene Effects to `input.color` (e.g. the output of `applyTreeEffects`)
 * and returns the resulting colour node, for your own pipeline. Empty settings return
 * `input.color`. With tone mapping the result is display colours: set
 * `pipeline.outputColorTransform = false`.
 */
export function applySceneEffects(input: SceneEffectInput, settings: SceneEffectsSettings): Node<'vec4'> {
  return liveSceneEffects(input, settings).node;
}
