import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { color as tslColor, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import type { TreeEffectInput } from './mask';

/** Leaf glow settings. */
export interface LeafGlowOptions {
  /** Glow colour, multiplied with the blurred leaf colour (default white). */
  color?: ColorRepresentation;
  /** Glow strength (default 0.6). */
  intensity?: number;
  /** Blur radius (Gaussian sigma, in pixels at half resolution; default 6). */
  radius?: number;
}

/**
 * Tree Effect: a soft glow of the leaves. The leaf pixels are blurred and added back onto the
 * tree pixels (leaves and the wood between them), never onto the rest of the scene.
 */
export function leafGlow(input: TreeEffectInput, options: LeafGlowOptions = {}): Node<'vec4'> {
  const { color = '#ffffff', intensity = 0.6, radius = 6 } = options;
  const leaves = vec4(input.color.rgb.mul(input.mask.g), 1);
  const blurred = gaussianBlur(leaves, null, radius, { resolutionScale: 0.5 });
  const glow = blurred.rgb.mul(tslColor(new Color(color))).mul(intensity).mul(input.mask.r);
  return vec4(input.color.rgb.add(glow), input.color.a);
}
