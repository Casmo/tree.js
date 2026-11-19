import type { Node, TextureNode } from 'three/webgpu';
import { convertToTexture, float, Fn, int, Loop, uniform, uv, vec2, vec4 } from 'three/tsl';
import type { SceneEffectStage } from './stage';

/** Motion blur settings (all optional; all uniforms). */
export interface SceneMotionBlurOptions {
  /**
   * How long the shutter is open, in frames: the blur streak is this many frames of motion long
   * (default 1). 0 = no blur.
   */
  strength?: number;
  /** Colour samples along each pixel's motion; more is smoother and costs more (default 16). */
  samples?: number;
}

const DEFAULTS: Required<SceneMotionBlurOptions> = { strength: 1, samples: 16 };

/**
 * Scene Effect: motion blur. Smears each pixel along its screen-space motion, read from `velocity`
 * (NDC units per frame, as three's `velocity`). Use the scene pass's Wind-aware velocity
 * (`windVelocityMRT()`, or `scenePass.velocity` of a Scene Pipeline with motion blur), so that Wind
 * sway blurs as well as camera and object motion. Use it on linear colours, after god rays and
 * before bloom. Returns a colour node.
 */
export function sceneMotionBlur(color: Node<'vec4'>, velocity: TextureNode, options: SceneMotionBlurOptions = {}): Node<'vec4'> {
  return liveSceneMotionBlur(color, velocity, options).node;
}

function liveSceneMotionBlur(color: Node<'vec4'>, velocity: TextureNode | undefined, options: SceneMotionBlurOptions) {
  if (!velocity) {
    throw new Error('tree.js sceneMotionBlur: needs a velocity channel (e.g. a scene pass with windVelocityMRT()).');
  }
  const strength = uniform(0);
  const samples = uniform(0, 'int');
  const update = (o: SceneMotionBlurOptions): void => {
    strength.value = o.strength ?? DEFAULTS.strength;
    samples.value = Math.max(1, Math.round(o.samples ?? DEFAULTS.samples));
  };
  update(options);
  // The blur samples around each pixel: a texture (the colour so far rendered to one when needed).
  const base = (color as Partial<TextureNode>).isTextureNode ? (color as TextureNode) : convertToTexture(color);
  const node = Fn(() => {
    const coord = uv();
    // NDC (y up, 2 units across) to texture coordinates (y down, 1 across), as three's TRAA does.
    const streak = velocity.sample(coord).xy.mul(vec2(0.5, -0.5)).mul(strength);
    const sum = vec4(0).toVar();
    // Evenly along the streak, centred on the pixel (the motion while the shutter is open).
    Loop({ start: int(0), end: samples, type: 'int', condition: '<' }, ({ i }) => {
      sum.addAssign(base.sample(coord.add(streak.mul(float(i).add(0.5).div(float(samples)).sub(0.5)))));
    });
    return sum.div(float(samples));
  })() as unknown as Node<'vec4'>;
  const dispose = (): void => {
    if (base !== color) base.dispose();
  };
  return { node, update, dispose };
}

/** The motion blur step of the stack: reads `input.velocity` (the Scene Pipeline requests it). */
export const motionBlurStage: SceneEffectStage = {
  shape: (settings) => (settings.motionBlur ? true : undefined),
  build(input, settings) {
    const live = liveSceneMotionBlur(input.color, input.velocity, settings.motionBlur!);
    return { node: live.node, update: (s) => live.update(s.motionBlur!), dispose: live.dispose };
  },
};
