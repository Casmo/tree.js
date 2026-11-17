import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { color as tslColor, float, mix, textureSize, uv, vec2, vec4 } from 'three/tsl';
import type { TreeEffectInput } from './mask';

/** Tree outline settings. */
export interface TreeOutlineOptions {
  /** Line colour (default a dark green-brown). */
  color?: ColorRepresentation;
  /** Line width in pixels (default 2). */
  thickness?: number;
  /** Opacity of the line, 0..1 (default 1). */
  strength?: number;
}

// Eight sample directions around a pixel (unit length).
const D = Math.SQRT1_2;
const DIRECTIONS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [D, D], [D, -D], [-D, D], [-D, -D]];

/**
 * Tree Effect: an outline along the silhouettes of the selected trees (the `selection` of the
 * tree mask, see `createTreeMask`; all trees by default), around the outside of the canopy and
 * the gaps in it. The line is drawn on the inside of the silhouette, so only tree pixels change.
 */
export function treeOutline(input: TreeEffectInput, options: TreeOutlineOptions = {}): Node<'vec4'> {
  const { color = '#1d2a14', thickness = 2, strength = 1 } = options;
  const { mask } = input;
  const step = vec2(thickness).div(vec2(textureSize(mask) as unknown as Node<'ivec2'>));
  const centre = uv();
  // Fraction of neighbours (at `thickness` px) that are not selected tree pixels.
  let outside: Node<'float'> = float(0);
  for (const [x, y] of DIRECTIONS) {
    outside = outside.add(float(1).sub(mask.sample(centre.add(step.mul(vec2(x, y)))).b));
  }
  const edge = outside.mul(3 / DIRECTIONS.length).clamp(0, 1).mul(mask.sample(centre).b).mul(strength);
  return vec4(mix(input.color.rgb, tslColor(new Color(color)), edge), input.color.a);
}
