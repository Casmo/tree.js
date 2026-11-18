import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { luminance, smoothstep, uniform, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import type { LiveTreeEffect } from './live';
import type { TreeEffectInput } from './mask';

/** Leaf glow settings. */
export interface LeafGlowOptions {
  /** Glow colour, multiplied with the blurred leaf colour (default white). */
  color?: ColorRepresentation;
  /** Glow strength (default 0.6). */
  intensity?: number;
  /** Only leaf pixels brighter than this (linear luminance) glow; 0 = all leaves (default 0.15). */
  threshold?: number;
  /** Blur radius (Gaussian sigma, in pixels at half resolution; default 6). */
  radius?: number;
}

/** The blur radius of leaf glow settings (part of a Tree Effects graph's shape). */
export function glowRadius(options: LeafGlowOptions): number {
  return options.radius ?? 6;
}

/**
 * Tree Effect: a soft glow of the leaves. The bright (sunlit) leaf pixels are blurred and added
 * back onto the tree pixels (leaves and the wood between them), never onto the rest of the scene.
 */
export function leafGlow(input: TreeEffectInput, options: LeafGlowOptions = {}): Node<'vec4'> {
  return liveLeafGlow(input, options).node;
}

/** {@link leafGlow} with its settings as uniforms; `radius` is fixed when built. */
export function liveLeafGlow(input: TreeEffectInput, options: LeafGlowOptions = {}): LiveTreeEffect<LeafGlowOptions> {
  const color = uniform(new Color());
  const intensity = uniform(0);
  const low = uniform(0);
  const high = uniform(0);
  const update = (o: LeafGlowOptions): void => {
    const threshold = o.threshold ?? 0.15;
    color.value.set(o.color ?? '#ffffff');
    intensity.value = o.intensity ?? 0.6;
    low.value = threshold;
    high.value = threshold * 2 + 0.05;
  };
  update(options);

  const bright = smoothstep(low, high, luminance(input.color.rgb));
  const leaves = vec4(input.color.rgb.mul(input.mask.g).mul(bright), 1);
  const blurred = gaussianBlur(leaves, null, glowRadius(options), { resolutionScale: 0.5 });
  const glow = blurred.rgb.mul(color).mul(intensity).mul(input.mask.r);
  return { node: vec4(input.color.rgb.add(glow), input.color.a), update };
}
