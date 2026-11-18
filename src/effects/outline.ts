import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { float, ivec2, max, mix, screenCoordinate, select, textureSize, uint, uniform, uv, vec2, vec4 } from 'three/tsl';
import type { LiveTreeEffect } from './live';
import type { TreeEffectInput } from './mask';

/** Tree outline settings. */
export interface TreeOutlineOptions {
  /** Line colour (default a dark green-brown). */
  color?: ColorRepresentation;
  /** Line width in pixels (default 2). */
  thickness?: number;
  /** Opacity of the line, 0..1 (default 1). */
  strength?: number;
  /**
   * Also draw the line between overlapping trees (Tree–Tree, Forest tree–Forest tree, Tree–Forest
   * tree): on a selected tree pixel next to another tree that is further away, so the line lies on
   * the front tree's side, as thick as the outer outline. Needs the `treeId` and `depth` inputs (see
   * `treeEffectsPass`). Default false. Changing it builds a new graph.
   */
  betweenTrees?: boolean;
}

// Eight sample directions around a pixel (unit length).
const D = Math.SQRT1_2;
const DIRECTIONS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [D, D], [D, -D], [-D, D], [-D, -D]];

/**
 * Tree Effect: an outline along the silhouettes of the selected trees (the `selection` of the
 * tree mask, see `createTreeMask`; all trees by default), around the outside of the canopy and
 * the gaps in it. The line is drawn on the inside of the silhouette, so only tree pixels change.
 * With `betweenTrees`, it is also drawn where a tree overlaps another one behind it.
 */
export function treeOutline(input: TreeEffectInput, options: TreeOutlineOptions = {}): Node<'vec4'> {
  return liveTreeOutline(input, options).node;
}

/** {@link treeOutline} with its settings as uniforms. */
export function liveTreeOutline(input: TreeEffectInput, options: TreeOutlineOptions = {}): LiveTreeEffect<TreeOutlineOptions> {
  const color = uniform(new Color());
  const thickness = uniform(0);
  const strength = uniform(0);
  const update = (o: TreeOutlineOptions): void => {
    color.value.set(o.color ?? '#1d2a14');
    thickness.value = o.thickness ?? 2;
    strength.value = o.strength ?? 1;
  };
  update(options);

  const { mask } = input;
  const step = vec2(thickness).div(vec2(textureSize(mask) as unknown as Node<'ivec2'>));
  const centre = uv();
  // Fraction of neighbours (at `thickness` px) that are not selected tree pixels.
  // With betweenTrees, a neighbour of another tree that is further away counts as outside too.
  const behind = options.betweenTrees === true ? otherTreeBehind(input, thickness) : null;
  let outside: Node<'float'> = float(0);
  for (const [x, y] of DIRECTIONS) {
    const notSelected = float(1).sub(mask.sample(centre.add(step.mul(vec2(x, y)))).b);
    outside = outside.add(behind ? max(notSelected, behind(x, y)) : notSelected);
  }
  const edge = outside.mul(3 / DIRECTIONS.length).clamp(0, 1).mul(mask.sample(centre).b).mul(strength);
  return { node: vec4(mix(input.color.rgb, color, edge), input.color.a), update };
}

/**
 * For `betweenTrees`: a function giving, per direction, 1 where the neighbour at `thickness` px is a
 * different tree (another nonzero Tree ID) that is further away than this pixel, 0 elsewhere. IDs
 * and depths are read with exact texel loads.
 */
function otherTreeBehind(input: TreeEffectInput, thickness: Node<'float'>): (x: number, y: number) => Node<'float'> {
  const { treeId, depth } = input;
  if (!treeId || !depth) {
    throw new Error(
      'treeOutline: betweenTrees needs the treeId and depth inputs; use treeEffectsPass(scene, camera, selection, { treeId: true })',
    );
  }
  const last = vec2(textureSize(treeId) as unknown as Node<'ivec2'>).sub(1);
  const here = screenCoordinate.xy;
  const id = uint(treeId.load(ivec2(here)).x);
  const z = depth.load(ivec2(here)).x;
  return (x, y) => {
    const at = ivec2(here.add(vec2(x, y).mul(thickness)).clamp(vec2(0, 0), last));
    const other = uint(treeId.load(at).x);
    const further = depth.load(at).x.greaterThan(z);
    return select(other.notEqual(uint(0)).and(other.notEqual(id)).and(further), float(1), float(0));
  };
}
