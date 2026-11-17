import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { color as tslColor, float, luminance, mix, select, vec3, vec4 } from 'three/tsl';
import type { TreeEffectInput } from './mask';

/** Tree colour grading settings (all optional; the defaults change nothing). */
export interface TreeColorGradeOptions {
  /** Brightness multiplier (default 1). */
  exposure?: number;
  /** 0 = grey, 1 = unchanged (default), > 1 = more saturated. */
  saturation?: number;
  /** Contrast around mid grey: 1 = unchanged (default), > 1 = more contrast. */
  contrast?: number;
  /** Colour multiplied in, e.g. a warm '#fff2dd' (default white). */
  tint?: ColorRepresentation;
}

const MID_GREY = 0.18; // linear

/**
 * Tree Effect: colour grading (exposure, tint, saturation, contrast) of the tree pixels only.
 * Returns the graded colour where the tree mask is set and `input.color` unchanged elsewhere.
 */
export function treeColorGrade(input: TreeEffectInput, options: TreeColorGradeOptions = {}): Node<'vec4'> {
  const { exposure = 1, saturation = 1, contrast = 1, tint = '#ffffff' } = options;
  const tinted = input.color.rgb.mul(tslColor(new Color(tint))).mul(exposure);
  const saturated = mix(vec3(luminance(tinted)), tinted, saturation).max(0);
  const contrasted = saturated.div(MID_GREY).pow(vec3(float(contrast))).mul(MID_GREY);
  return select(input.mask.r.greaterThan(0.5), vec4(contrasted, input.color.a), input.color);
}
