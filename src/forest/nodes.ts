import type { Node } from 'three/webgpu';
import { attribute, cross, positionGeometry, positionLocal } from 'three/tsl';
import { growthPosition } from '../growth';
import { objectWindDirection, windOffset, type WindResponse, type WindSource } from '../wind';

/**
 * Per-instance data of a Forest (one interleaved instanced buffer, 8 floats per tree):
 * `iRotation` = the tree's rotation as a quaternion (x, y, z, w);
 * `iState` = (scale, Growth, Season, Wind phase), Growth/Season already include the tree's offsets.
 */
export const INSTANCE_STRIDE = 8;
export const INSTANCE_ATTRIBUTES = { iRotation: 0, iState: 4 } as const;

/** Per-tree values in the instanced Season/Growth/Wind slots. */
export function instanceState(): { scale: Node<'float'>; growth: Node<'float'>; season: Node<'float'>; windPhase: Node<'float'> } {
  const state = attribute<'vec4'>('iState', 'vec4');
  return { scale: state.x, growth: state.y, season: state.z, windPhase: state.w };
}

/** Rotates `v` by the instance quaternion (`inverse` = by its conjugate). */
function rotate(v: Node<'vec3'>, inverse = false): Node<'vec3'> {
  const q = attribute<'vec4'>('iRotation', 'vec4');
  const u = inverse ? q.xyz.negate() : q.xyz;
  const t = cross(u, v).mul(2);
  return v.add(t.mul(q.w)).add(cross(u, t));
}

/**
 * The vertex position of a Forest tree (positionNode of an instanced Variant mesh).
 *
 * On an InstancedMesh, three.js applies the instance matrix to `positionLocal` before
 * `positionNode` runs, but Growth and Wind are defined in the tree's own space (about the
 * generated `aOrigin`s, relative to its trunk height). So both are computed from
 * `positionGeometry`, and only their displacement is turned into forest space with the
 * instance rotation and scale: M·(p + d) = M·p + R·s·d. The Wind direction goes the other way
 * (forest -> tree space) and each tree sways with its own phase.
 */
export function forestPosition(wind: WindSource, response: WindResponse): Node<'vec3'> {
  const { scale, growth, windPhase } = instanceState();
  const grown = growthPosition(growth, positionGeometry);
  const offset = windOffset(wind, response, { direction: rotate(objectWindDirection(wind), true), phase: windPhase });
  const displacement = grown.add(offset).sub(positionGeometry);
  return positionLocal.add(rotate(displacement).mul(scale));
}
