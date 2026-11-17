import { attribute, float, normalGeometry, positionLocal } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { MIN_WINDOW, SAPLING_SCALE, SAPLING_THICKNESS } from './evaluate';

/**
 * Growth in TSL: the vertex position of a tree part at Growth `growth` (a float node, usually the
 * tree's Growth uniform; a Forest can pass a per-instance attribute instead). Same model as
 * `growPositions` (see `./evaluate.ts`), driven by the Generator's `aGrowth` and `aOrigin` attributes.
 *
 * `position` is the input position (default `positionLocal`). To compose with other vertex effects,
 * feed this node into them, e.g. `material.positionNode = windPosition(growthPosition(uGrowth))`:
 * Growth first, so the rest acts on the grown tree.
 */
export function growthPosition(growth: Node<'float'>, position: Node<'vec3'> = positionLocal): Node<'vec3'> {
  const g = float(growth).clamp(0, 1);
  const data = attribute<'vec3'>('aGrowth', 'vec3');
  const origin = attribute<'vec3'>('aOrigin', 'vec3');
  const start = data.x;
  const end = data.y;
  const radius = data.z;

  // partProgress: 1 from `end` on, eased.
  const p = g.sub(end).div(end.sub(start).max(MIN_WINDOW)).add(1).clamp(0, 1);
  const progress = p.mul(p).mul(p.mul(-2).add(3));
  const thin = float(1 - SAPLING_THICKNESS).mul(float(1).sub(g)); // 1 - thickness(g)
  const shrinkTree = float(1 - SAPLING_SCALE).mul(float(1).sub(g)); // 1 - treeScale(g)

  const thick = position.sub(normalGeometry.mul(radius.mul(thin)));
  const sprouted = thick.sub(thick.sub(origin).mul(float(1).sub(progress)));
  return sprouted.sub(sprouted.mul(shrinkTree));
}
