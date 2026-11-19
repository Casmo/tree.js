import type { Node, NodeBuilder } from 'three/webgpu';
import { attribute, bool, cross, Fn, instanceIndex, normalLocal, positionGeometry, positionLocal } from 'three/tsl';
import { growthPosition } from '../growth';
import { objectWindDirection, windOffset, type WindResponse, type WindSource } from '../wind';

/**
 * Per-instance data of a Forest (one interleaved instanced buffer, 8 floats per tree):
 * `iRotation` = the tree's rotation as a quaternion (x, y, z, w);
 * `iState` = (scale, Growth, Season, Wind phase), Growth/Season already include the tree's offsets.
 */
export const INSTANCE_STRIDE = 8;
export const INSTANCE_ATTRIBUTES = { iRotation: 0, iState: 4 } as const;

/**
 * What a mesh that draws one Detail Level of a Variant (ADR 0010) reads instead of the instanced
 * attributes: the tree's data by slot, the slot coming from the level list at `instanceIndex`.
 */
export interface LevelInstance {
  /** The tree's slot in the Variant (`uint`). */
  slot: Node<'uint'>;
  /** As `iRotation`. */
  rotation: Node<'vec4'>;
  /** As `iState`. */
  state: Node<'vec4'>;
  /** The tree's base in forest space. */
  position: Node<'vec3'>;
  /** The tree's cross-fade mask at this level (`bool`: draw this fragment), see `levelDither`. */
  visible: Node<'bool'>;
}

// Which mesh draws a Detail Level, and from where. Looked up when a material is built for an object,
// so the Variant's materials serve its instanced meshes and its Detail Level meshes alike.
const levelInstances = new WeakMap<object, LevelInstance>();

/** @internal Marks `mesh` as drawing a Detail Level: every Forest node built for it reads `instance`. */
export function drawsDetailLevel(mesh: object, instance: LevelInstance): void {
  levelInstances.set(mesh, instance);
}

function levelInstanceOf(builder: NodeBuilder): LevelInstance | undefined {
  const object = builder.object as object | null | undefined;
  return object ? levelInstances.get(object) : undefined;
}

/**
 * A node that is `level(instance)` on a Detail Level mesh and `instanced()` on anything else (the
 * Variant's instanced meshes), decided when the material is built for the drawn object.
 */
function perInstance<T extends Node>(instanced: () => T, level: (instance: LevelInstance) => T): T {
  return Fn((builder: NodeBuilder) => {
    const instance = levelInstanceOf(builder);
    return instance ? level(instance) : instanced();
  })() as unknown as T;
}

/** The tree's quaternion. */
function instanceRotation(): Node<'vec4'> {
  return perInstance(
    () => attribute<'vec4'>('iRotation', 'vec4'),
    (instance) => instance.rotation,
  );
}

/** Per-tree values in the instanced Season/Growth/Wind slots. */
export function instanceState(): { scale: Node<'float'>; growth: Node<'float'>; season: Node<'float'>; windPhase: Node<'float'> } {
  const state = perInstance(
    () => attribute<'vec4'>('iState', 'vec4'),
    (instance) => instance.state,
  );
  return { scale: state.x, growth: state.y, season: state.z, windPhase: state.w };
}

/** The tree's slot in its Variant (`uint`): the instance index on the instanced meshes, from the level list on a Detail Level mesh. */
export function instanceSlot(): Node<'uint'> {
  return perInstance(
    () => instanceIndex as unknown as Node<'uint'>,
    (instance) => instance.slot,
  );
}

/** Whether to draw this fragment: the Detail Level cross-fade (always true on the instanced meshes). */
export function levelVisible(): Node<'bool'> {
  return perInstance(
    () => bool(true),
    (instance) => instance.visible,
  );
}

/**
 * The tree's base in forest space, on a Detail Level mesh (the Impostor card places itself from it).
 * Throws when built for any other object: the instanced meshes get their position from three.js.
 */
export function levelTreePosition(): Node<'vec3'> {
  return perInstance(
    () => {
      throw new Error('levelTreePosition() only works on a Detail Level mesh');
    },
    (instance) => instance.position,
  );
}

/** Rotates `v` by the quaternion `q` (`inverse` = by its conjugate). */
export function rotateByQuaternion(q: Node<'vec4'>, v: Node<'vec3'>, inverse = false): Node<'vec3'> {
  const u = inverse ? q.xyz.negate() : q.xyz;
  const t = cross(u, v).mul(2);
  return v.add(t.mul(q.w)).add(cross(u, t));
}

/** Rotates `v` by the instance quaternion (`inverse` = by its conjugate): tree space to forest space. */
export function instanceRotate(v: Node<'vec3'>, inverse = false): Node<'vec3'> {
  return rotateByQuaternion(instanceRotation(), v, inverse);
}

/**
 * The tree's vertex placed in forest space without Growth or Wind (M·p). On an InstancedMesh three.js
 * already applied the instance matrix to `positionLocal` (and the normal). A Detail Level mesh is not
 * instanced by three, so this places the vertex from the tree's data and turns the normal with it.
 */
function placedPosition(): Node<'vec3'> {
  return perInstance(
    () => positionLocal,
    (instance) => {
      normalLocal.assign(rotateByQuaternion(instance.rotation, normalLocal));
      return instance.position.add(rotateByQuaternion(instance.rotation, positionGeometry).mul(instance.state.x));
    },
  );
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
 *
 * `base`: the tree-space position Growth starts from (default `positionGeometry`); Fruit passes
 * its Season-scaled position here.
 */
export function forestPosition(wind: WindSource, response: WindResponse, base: Node<'vec3'> = positionGeometry): Node<'vec3'> {
  const { scale, growth, windPhase } = instanceState();
  const grown = growthPosition(growth, base);
  const offset = windOffset(wind, response, { direction: instanceRotate(objectWindDirection(wind), true), phase: windPhase });
  const displacement = grown.add(offset).sub(positionGeometry);
  return placedPosition().add(instanceRotate(displacement).mul(scale));
}
