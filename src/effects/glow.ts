import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { color as tslColor, luminance, smoothstep, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
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

/**
 * Tree Effect: a soft glow of the leaves. The bright (sunlit) leaf pixels are blurred and added
 * back onto the tree pixels (leaves and the wood between them), never onto the rest of the scene.
 */
export function leafGlow(input: TreeEffectInput, options: LeafGlowOptions = {}): Node<'vec4'> {
  const { color = '#ffffff', intensity = 0.6, threshold = 0.15, radius = 6 } = options;
  const bright = smoothstep(threshold, threshold * 2 + 0.05, luminance(input.color.rgb));
  const leaves = vec4(input.color.rgb.mul(input.mask.g).mul(bright), 1);
  const blurred = gaussianBlur(leaves, null, radius, { resolutionScale: 0.5 });
  const glow = blurred.rgb.mul(tslColor(new Color(color))).mul(intensity).mul(input.mask.r);
  return vec4(input.color.rgb.add(glow), input.color.a);
}
