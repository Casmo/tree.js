import type { Node, NodeMaterial } from 'three/webgpu';
import {
  attribute,
  cross,
  dot,
  modelWorldMatrixInverse,
  normalGeometry,
  positionGeometry,
  positionLocal,
  sin,
  vec3,
  vec4,
} from 'three/tsl';
import type { Wind } from './Wind';
import type { WindResponse } from './response';

// Sway amplitudes at Wind strength 1 and response 1, as a fraction of the trunk height.
const TRUNK_AMPLITUDE = 0.15;
const BRANCH_AMPLITUDE = 0.1;
// Leaf flutter, as a fraction of the distance from the leaf base.
const LEAF_AMPLITUDE = 0.2;

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
 * object space (rotation only, so a scaled-up tree sways proportionally more).
 */
export function windOffset(wind: Wind, response: WindResponse): Node<'vec3'> {
  const weights = attribute('aWind', 'vec3');
  const random = attribute('aRandom', 'float');
  const origin = attribute('aOrigin', 'vec3');
  const r = response.uniforms;
  const strength = wind.uniforms.strength;

  const t = wind.uniforms.time.mul(r.frequency).add(r.phase);
  const direction = modelWorldMatrixInverse.mul(vec4(wind.uniforms.direction, 0)).xyz.normalize();
  const across = cross(direction, vec3(0, 1, 0));
  // 0.6 .. 1: two slow, incommensurate waves.
  const gust = sin(t.mul(0.37)).add(sin(t.mul(0.91).add(1.7))).mul(0.1).add(0.8);
  const scale = strength.mul(r.height).mul(gust);

  const trunkSwing = sin(t.mul(1.1)).mul(0.25).add(0.75); // 0.5 .. 1: lean plus swing
  const trunk = direction.mul(trunkSwing.mul(r.trunk).mul(weights.x).mul(scale).mul(TRUNK_AMPLITUDE));

  const spatialPhase = dot(positionGeometry, vec3(0.9, 0.4, 0.7));
  const branchSwing = sin(t.mul(2.3).add(spatialPhase)).mul(0.35).add(0.65); // 0.3 .. 1
  const branchCross = sin(t.mul(1.7).add(spatialPhase.mul(1.3))).mul(0.3);
  const branches = direction
    .mul(branchSwing)
    .add(across.mul(branchCross))
    .mul(r.branches.mul(weights.y).mul(scale).mul(BRANCH_AMPLITUDE));

  const leafLength = positionGeometry.sub(origin).length();
  const flutter = sin(t.mul(9).add(random.mul(6.2832)));
  const leaves = normalGeometry.mul(
    flutter.mul(r.leaves).mul(weights.z).mul(leafLength).mul(strength).mul(gust).mul(LEAF_AMPLITUDE),
  );

  return trunk.add(branches).add(leaves);
}

/**
 * Adds a Wind offset to a material's vertex position (its existing `positionNode`, or the plain
 * local position). The shadow pass reuses `positionNode`, so shadows sway along.
 */
export function applyWind(material: NodeMaterial, offset: Node<'vec3'>): void {
  material.positionNode = material.positionNode ? (material.positionNode as Node<'vec3'>).add(offset) : positionLocal.add(offset);
  material.needsUpdate = true;
}
