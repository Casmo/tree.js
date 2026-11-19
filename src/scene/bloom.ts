import type { Node } from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { SceneEffectStage } from './stage';

/** Bloom settings (all optional; all uniforms). */
export interface SceneBloomOptions {
  /** How much glare is added (default 0.3). */
  strength?: number;
  /** How far the glare spreads, 0..1 (default 0.5). */
  radius?: number;
  /** Only colours brighter than this (linear luminance, before tone mapping) glow (default 0.6; a plain light sky is about 0.6). */
  threshold?: number;
}

const DEFAULTS: Required<SceneBloomOptions> = { strength: 0.3, radius: 0.5, threshold: 0.6 };

/**
 * Scene Effect: bloom, a soft glare around the bright (HDR) parts of the frame, added onto the
 * colour. Use it on linear colours before tone mapping.
 */
export function sceneBloom(color: Node<'vec4'>, options: SceneBloomOptions = {}): Node<'vec4'> {
  return liveSceneBloom(color, options).node;
}

function liveSceneBloom(color: Node<'vec4'>, options: SceneBloomOptions) {
  const strength = uniform(0);
  const radius = uniform(0);
  const threshold = uniform(0);
  const update = (o: SceneBloomOptions): void => {
    strength.value = o.strength ?? DEFAULTS.strength;
    radius.value = o.radius ?? DEFAULTS.radius;
    threshold.value = o.threshold ?? DEFAULTS.threshold;
  };
  update(options);
  const glare = bloom(color, strength, radius, threshold);
  // Add the glare's colour only: the frame keeps its own alpha.
  const node = vec4(color.rgb.add(glare.rgb), color.a) as unknown as Node<'vec4'>;
  return { node, update, dispose: () => glare.dispose() };
}

/** The bloom step of the stack (one graph for all settings: every number is a uniform). */
export const bloomStage: SceneEffectStage = {
  shape: (settings) => (settings.bloom ? true : undefined),
  build(input, settings) {
    const live = liveSceneBloom(input.color, settings.bloom!);
    return { node: live.node, update: (s) => live.update(s.bloom!), dispose: live.dispose };
  },
};
