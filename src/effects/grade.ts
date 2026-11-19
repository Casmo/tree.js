import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { luminance, mix, select, uniform, vec3, vec4 } from 'three/tsl';
import type { LiveTreeEffect } from './live';
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
  return liveTreeColorGrade(input, options).node;
}

/** {@link treeColorGrade} with its settings as uniforms. */
export function liveTreeColorGrade(input: TreeEffectInput, options: TreeColorGradeOptions = {}): LiveTreeEffect<TreeColorGradeOptions> {
  const tint = uniform(new Color());
  const exposure = uniform(0);
  const saturation = uniform(0);
  const contrast = uniform(0);
  const update = (o: TreeColorGradeOptions): void => {
    tint.value.set(o.tint ?? '#ffffff');
    exposure.value = o.exposure ?? 1;
    saturation.value = o.saturation ?? 1;
    contrast.value = o.contrast ?? 1;
  };
  update(options);

  const tinted = input.color.rgb.mul(tint).mul(exposure);
  const saturated = mix(vec3(luminance(tinted)), tinted, saturation).max(0);
  const contrasted = saturated.div(MID_GREY).pow(vec3(contrast)).mul(MID_GREY);
  const node = select(input.mask.r.greaterThan(0.5), vec4(contrasted, input.color.a), input.color);
  return { node, update };
}
