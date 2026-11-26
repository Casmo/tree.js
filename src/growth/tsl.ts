import { attribute, float, Fn, normalGeometry, positionLocal } from 'three/tsl';
import type { Node, NodeBuilder } from 'three/webgpu';
import { MIN_WINDOW, SAPLING_SCALE, SAPLING_THICKNESS } from './evaluate';

// The TSL twins of the helpers in `./evaluate.ts`, step for step.

/** Size of the whole tree at Growth `g` (twin of `treeScale`): the scale `growthPosition` gives the tree. */
export const growthScale = (g: Node<'float'>): Node<'float'> => float(SAPLING_SCALE).add(float(1 - SAPLING_SCALE).mul(g));

/** Branch thickness at Growth `g` (twin of `thickness`). */
const thickness = (g: Node<'float'>): Node<'float'> => float(SAPLING_THICKNESS).add(float(1 - SAPLING_THICKNESS).mul(g));

/** Where Growth `g` is in a window, 0..1, 1 from `end` on (a zero-width window is done at `end`). */
const windowProgress = (g: Node<'float'>, start: Node<'float'>, end: Node<'float'>): Node<'float'> =>
  g.sub(end).div(end.sub(start).max(MIN_WINDOW)).add(1).clamp(0, 1);

/** How far one part has sprouted, eased (twin of `partProgress`). */
function partProgress(g: Node<'float'>, start: Node<'float'>, end: Node<'float'>): Node<'float'> {
  const p = windowProgress(g, start, end);
  return p.mul(p).mul(float(3).sub(p.mul(2)));
}

/** How far one leaf has unfolded by its leaf curve, ease-out (twin of `leafProgress`). */
function leafProgress(g: Node<'float'>, start: Node<'float'>, end: Node<'float'>): Node<'float'> {
  const rest = float(1).sub(windowProgress(g, start, end));
  return float(1).sub(rest.mul(rest));
}

/**
 * Growth in TSL: the vertex position of a tree part at Growth `growth` (a float node, usually the
 * tree's Growth uniform; a Forest can pass a per-instance attribute instead). Same model and steps
 * as `growPositions` (see `./evaluate.ts`), driven by the Generator's `aGrowth` and `aOrigin` attributes;
 * on a geometry with `aTwigGrowth` (leaves, ADR 0019) by the leaf model, which rides on the twig. Which
 * of the two is decided when the shader is built for a geometry, so Growth stays a single uniform.
 *
 * `position` is the input position (default `positionLocal`). To compose with other vertex effects,
 * feed this node into them, e.g. `material.positionNode = windPosition(growthPosition(uGrowth))`:
 * Growth first, so the rest acts on the grown tree.
 */
export function growthPosition(growth: Node<'float'>, position: Node<'vec3'> = positionLocal): Node<'vec3'> {
  return Fn((builder: NodeBuilder) => {
    const leaves = builder.geometry?.hasAttribute('aTwigGrowth') === true;
    return grown(growth, position, leaves);
  })() as unknown as Node<'vec3'>;
}

function grown(growth: Node<'float'>, position: Node<'vec3'>, leaves: boolean): Node<'vec3'> {
  const g = float(growth).clamp(0, 1);
  const data = attribute<'vec3'>('aGrowth', 'vec3');
  const origin = attribute<'vec3'>('aOrigin', 'vec3');
  const [start, end, radius] = [data.x, data.y, data.z];

  const scale = growthScale(g);
  const thin = float(1).sub(thickness(g));
  const thick = position.sub(normalGeometry.mul(radius).mul(thin));
  let sprouted: Node<'vec3'>;
  if (leaves) {
    // A leaf unfolds by its leaf curve times its twig's progress, and is carried by its twig's sprout.
    const twigWindow = attribute<'vec2'>('aTwigGrowth', 'vec2');
    const twigOrigin = attribute<'vec3'>('aTwigOrigin', 'vec3');
    const twig = partProgress(g, twigWindow.x, twigWindow.y);
    const unfolded = thick.sub(thick.sub(origin).mul(float(1).sub(leafProgress(g, start, end).mul(twig))));
    sprouted = unfolded.sub(unfolded.sub(twigOrigin).mul(float(1).sub(twig)));
  } else {
    sprouted = thick.sub(thick.sub(origin).mul(float(1).sub(partProgress(g, start, end))));
  }
  return sprouted.sub(sprouted.mul(float(1).sub(scale)));
}
