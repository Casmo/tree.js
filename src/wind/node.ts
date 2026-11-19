import type { Node, NodeMaterial } from 'three/webgpu';
import {
  attribute,
  cross,
  dot,
  float,
  modelWorldMatrixInverse,
  normalGeometry,
  positionGeometry,
  positionLocal,
  sin,
  vec3,
  vec4,
} from 'three/tsl';
import type { WindUniforms } from './Wind';
import type { WindResponse } from './response';

// Sway amplitudes at Wind strength 1 and response 1, as a fraction of the trunk height.
const TRUNK_AMPLITUDE = 0.15;
const BRANCH_AMPLITUDE = 0.1;
// Leaf flutter, as a fraction of the distance from the leaf base.
const LEAF_AMPLITUDE = 0.2;

/**
 * Overrides for trees that are not one object each (Forest instances): the Wind direction in
 * the tree's own space and the tree's phase (radians), e.g. from per-instance attributes; and the
 * Wind time (seconds) to evaluate the sway at (default the Wind's own clock), e.g. the previous
 * frame's for Wind-aware velocity.
 */
export interface WindFrame {
  direction?: Node<'vec3'>;
  phase?: Node<'float'>;
  time?: Node<'float'>;
}

/** Anything holding Wind uniforms: a {@link Wind} or a {@link WindBinding} that follows one. */
export interface WindSource {
  readonly uniforms: WindUniforms;
}

/** The scene Wind direction in the rendered object's space (rotation only, normalized). */
export function objectWindDirection(wind: WindSource): Node<'vec3'> {
  return modelWorldMatrixInverse.mul(vec4(wind.uniforms.direction, 0)).xyz.normalize();
}

/**
 * TSL node: the Wind displacement (vec3, object space) of each vertex, from the per-vertex
 * `aWind` weights (trunk sway, branch sway, leaf flutter), the tree's Wind response and the
 * scene Wind. It only depends on geometry attributes and uniforms, so it adds onto any other
 * position node (Growth): `position = grown + windOffset(...)` (see {@link applyWind}).
 *
 * - trunk: leans with the wind and swings slowly, bending from the ground (weight = height²);
 * - branches: swing faster, with a phase that varies smoothly in space so joints stay attached,
 *   plus a little cross-wind motion;
 * - leaves: flutter along their normal, more at the tip.
 * All of it is scaled by slow gusts. Wind direction is world space; it is turned into the tree's
 * object space (rotation only, so a scaled-up tree sways proportionally more). `frame` replaces
 * that direction, the response's phase and the Wind time (see {@link WindFrame}).
 */
export function windOffset(wind: WindSource, response: WindResponse, frame: WindFrame = {}): Node<'vec3'> {
  const weights = attribute('aWind', 'vec3');
  const random = attribute('aRandom', 'float');
  const origin = attribute('aOrigin', 'vec3');
  const motion = windMotion(wind, response, frame);
  const { t, gust } = motion;
  const sway = swayOffset(motion, response, { trunk: weights.x, branches: weights.y, spatialPhase: dot(positionGeometry, vec3(0.9, 0.4, 0.7)) });

  const leafLength = positionGeometry.sub(origin).length();
  const flutter = sin(t.mul(9).add(random.mul(6.2832)));
  const leaves = normalGeometry.mul(
    flutter.mul(response.uniforms.leaves).mul(weights.z).mul(leafLength).mul(wind.uniforms.strength).mul(gust).mul(LEAF_AMPLITUDE),
  );

  return sway.add(leaves);
}

/** The Wind clock, direction and gusts one tree sways with. */
interface WindMotion {
  /** The tree's Wind time (seconds × frequency + phase). */
  t: Node<'float'>;
  direction: Node<'vec3'>;
  /** 0.6 .. 1: two slow, incommensurate waves. */
  gust: Node<'float'>;
  /** Strength × trunk height × gust. */
  scale: Node<'float'>;
}

function windMotion(wind: WindSource, response: WindResponse, frame: WindFrame): WindMotion {
  const r = response.uniforms;
  const t = (frame.time ?? wind.uniforms.time).mul(r.frequency).add(frame.phase ?? r.phase);
  const direction = (frame.direction ?? objectWindDirection(wind)).normalize();
  const gust = sin(t.mul(0.37)).add(sin(t.mul(0.91).add(1.7))).mul(0.1).add(0.8);
  return { t, direction, gust, scale: wind.uniforms.strength.mul(r.height).mul(gust) };
}

/** Trunk and branch sway weights (as `aWind.x`, `aWind.y`) and the branch's spatial phase. */
interface SwayWeights {
  trunk: Node<'float'>;
  branches: Node<'float'>;
  spatialPhase: Node<'float'>;
}

function swayOffset({ t, direction, scale }: WindMotion, response: WindResponse, weights: SwayWeights): Node<'vec3'> {
  const r = response.uniforms;
  const across = cross(direction, vec3(0, 1, 0));
  const trunkSwing = sin(t.mul(1.1)).mul(0.25).add(0.75); // 0.5 .. 1: lean plus swing
  const trunk = direction.mul(trunkSwing.mul(r.trunk).mul(weights.trunk).mul(scale).mul(TRUNK_AMPLITUDE));

  const branchSwing = sin(t.mul(2.3).add(weights.spatialPhase)).mul(0.35).add(0.65); // 0.3 .. 1
  const branchCross = sin(t.mul(1.7).add(weights.spatialPhase.mul(1.3))).mul(0.3);
  const branches = direction
    .mul(branchSwing)
    .add(across.mul(branchCross))
    .mul(r.branches.mul(weights.branches).mul(scale).mul(BRANCH_AMPLITUDE));
  return trunk.add(branches);
}

/** Branch sway of a whole crown as one: about the mean of `aWind.y` over a crown. */
const CROWN_BRANCH_SWAY = 0.5;

/**
 * TSL node: the Wind displacement (vec3, the tree's space) of a whole tree drawn as one picture (an
 * Impostor card), at the tree-space point `point`: the trunk sway of its height (as `aWind.x`:
 * (height / trunk height)², clamped), with the crown's branches swinging along as one. No leaf flutter.
 */
export function treeSwayOffset(wind: WindSource, response: WindResponse, point: Node<'vec3'>, frame: WindFrame = {}): Node<'vec3'> {
  const h = point.y.div(response.uniforms.height.max(1e-6)).clamp(0, 1);
  const trunk = h.mul(h);
  return swayOffset(windMotion(wind, response, frame), response, { trunk, branches: trunk.mul(CROWN_BRANCH_SWAY), spatialPhase: float(0) });
}

/**
 * Adds a Wind offset to a material's vertex position (its existing `positionNode`, or the plain
 * local position). The shadow pass reuses `positionNode`, so shadows sway along.
 */
export function applyWind(material: NodeMaterial, offset: Node<'vec3'>): void {
  material.positionNode = material.positionNode ? (material.positionNode as Node<'vec3'>).add(offset) : positionLocal.add(offset);
  material.needsUpdate = true;
}
