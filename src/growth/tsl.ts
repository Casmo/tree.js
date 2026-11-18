import { attribute, float, normalGeometry, positionLocal } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { MIN_WINDOW, SAPLING_SCALE, SAPLING_THICKNESS } from './evaluate';

// The TSL twins of the helpers in `./evaluate.ts`, step for step.

/** Size of the whole tree at Growth `g` (twin of `treeScale`): every grown position is scaled by it about the tree origin. */
export const treeScale = (g: Node<'float'>): Node<'float'> => float(SAPLING_SCALE).add(float(1 - SAPLING_SCALE).mul(g));

/** Branch thickness at Growth `g` (twin of `thickness`). */
const thickness = (g: Node<'float'>): Node<'float'> => float(SAPLING_THICKNESS).add(float(1 - SAPLING_THICKNESS).mul(g));

/** How far one part has sprouted, eased (twin of `partProgress`). */
function partProgress(g: Node<'float'>, start: Node<'float'>, end: Node<'float'>): Node<'float'> {
  const p = g.sub(end).div(end.sub(start).max(MIN_WINDOW)).add(1).clamp(0, 1);
  return p.mul(p).mul(float(3).sub(p.mul(2)));
}

/**
 * Growth in TSL: the vertex position of a tree part at Growth `growth` (a float node, usually the
 * tree's Growth uniform; a Forest can pass a per-instance attribute instead). Same model and steps
 * as `growPositions` (see `./evaluate.ts`), driven by the Generator's `aGrowth` and `aOrigin` attributes.
 *
 * `position` is the input position (default `positionLocal`). To compose with other vertex effects,
 * feed this node into them, e.g. `material.positionNode = windPosition(growthPosition(uGrowth))`:
 * Growth first, so the rest acts on the grown tree.
 */
export function growthPosition(growth: Node<'float'>, position: Node<'vec3'> = positionLocal): Node<'vec3'> {
  const g = float(growth).clamp(0, 1);
  const data = attribute<'vec3'>('aGrowth', 'vec3');
  const origin = attribute<'vec3'>('aOrigin', 'vec3');
  const [start, end, radius] = [data.x, data.y, data.z];

  const scale = treeScale(g);
  const thin = float(1).sub(thickness(g));
  const shrink = float(1).sub(partProgress(g, start, end));

  const thick = position.sub(normalGeometry.mul(radius).mul(thin));
  const sprouted = thick.sub(thick.sub(origin).mul(shrink));
  return sprouted.sub(sprouted.mul(float(1).sub(scale)));
}
