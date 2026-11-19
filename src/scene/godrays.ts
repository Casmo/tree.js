import { Color, type Camera, type ColorRepresentation, type DirectionalLight, type Light, type Node, type PointLight, type TextureNode } from 'three/webgpu';
import { convertToTexture, uniform } from 'three/tsl';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import type { SceneEffectStage } from './stage';

/** God rays settings (all optional; every colour and number is a uniform). */
export interface SceneGodraysOptions {
  /** How dense the lit air is: more makes brighter shafts and haze (default 1.5). */
  density?: number;
  /** The most the shafts cover a pixel, 0..1 (default 0.5). */
  maxDensity?: number;
  /** How fast the shafts fade with the distance from the sun's shadow camera (default 0.6). */
  distanceAttenuation?: number;
  /** The colour of the light in the shafts (default '#fff0c8', warm sunlight). */
  color?: ColorRepresentation;
  /** The search radius in pixels for depth edges in the blend, against light leaking around trunks (default 2). */
  edgeRadius?: number;
  /** How far the blend steps away from a depth edge, in pixels (default 2). */
  edgeStrength?: number;
}

/** A light god rays can use: a directional or point light that casts shadows. */
export type SceneGodraysSun = DirectionalLight | PointLight;

/** Why `sun` cannot drive god rays, or `undefined` when it can. */
export function godraysSunProblem(sun: Light | undefined): string | undefined {
  if (!sun) return 'no `sun` light was given';
  const { isDirectionalLight, isPointLight } = sun as Partial<DirectionalLight & PointLight>;
  if (!isDirectionalLight && !isPointLight) return 'the `sun` must be a DirectionalLight or a PointLight';
  if (!sun.castShadow) return 'the `sun` does not cast shadows (the pipeline never turns shadows on)';
  return undefined;
}

/**
 * Scene Effect: god rays, light shafts through the canopy, raymarched through the shadow map of a
 * shadow-casting `sun` and blended depth-aware onto `color` (no light leaking around trunks and
 * leaves). Needs a full shadow setup by the app: `renderer.shadowMap.enabled`, the sun's
 * `castShadow` and casting objects; nothing is changed here. `depth` and `camera` are those of the
 * scene pass. Returns a colour node (not display colours).
 */
export function sceneGodrays(
  color: Node<'vec4'>,
  depth: TextureNode,
  camera: Camera,
  sun: SceneGodraysSun,
  options: SceneGodraysOptions = {},
): Node<'vec4'> {
  return liveSceneGodrays(color, depth, camera, sun, options).node;
}

function liveSceneGodrays(color: Node<'vec4'>, depth: TextureNode, camera: Camera, sun: SceneGodraysSun, options: SceneGodraysOptions) {
  const rays = godrays(depth, camera, sun);
  const tint = uniform(new Color());
  const edgeRadius = uniform(2, 'int');
  const edgeStrength = uniform(2, 'float');
  const update = (o: SceneGodraysOptions): void => {
    rays.density.value = o.density ?? 1.5;
    rays.maxDensity.value = o.maxDensity ?? 0.5;
    rays.distanceAttenuation.value = o.distanceAttenuation ?? 0.6;
    tint.value.set(o.color ?? '#fff0c8');
    edgeRadius.value = Math.round(o.edgeRadius ?? 2);
    edgeStrength.value = o.edgeStrength ?? 2;
  };
  update(options);
  // The blend samples its base around each pixel: a texture (the colour so far rendered to one when needed).
  const base = (color as Partial<TextureNode>).isTextureNode ? (color as TextureNode) : convertToTexture(color);
  const node = depthAwareBlend(base, rays.getTextureNode(), depth, camera, { blendColor: tint, edgeRadius, edgeStrength });
  const dispose = (): void => {
    rays.dispose();
    if (base !== color) base.dispose();
  };
  return { node, update, dispose };
}

/** Warns that god rays are skipped, and why. */
export function warnGodraysSkipped(problem: string): void {
  console.warn(`tree.js Scene Effects: god rays skipped, ${problem}.`);
}

/**
 * The god rays step of the stack. It reads `input.depth`, `input.camera` and `input.sun`; without a
 * usable sun it is skipped with a console warning (the Scene Pipeline leaves it out before, warning once).
 */
export const godraysStage: SceneEffectStage = {
  shape: (settings) => (settings.godrays ? true : undefined),
  build(input, settings) {
    const problem = godraysSunProblem(input.sun) ?? (input.depth && input.camera ? undefined : 'the scene depth and camera are missing');
    if (problem) {
      warnGodraysSkipped(problem);
      return { node: input.color, update: () => {} };
    }
    const live = liveSceneGodrays(input.color, input.depth!, input.camera!, input.sun as SceneGodraysSun, settings.godrays!);
    return { node: live.node, update: (s) => live.update(s.godrays!), dispose: live.dispose };
  },
};
