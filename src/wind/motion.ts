import type { Node } from 'three/webgpu';
import { Wind, WindBinding } from './Wind';
import type { WindSource } from './node';

/**
 * How a tree material's vertices move with the Wind between two Wind times, for Wind-aware velocity
 * (ADR 0011). Registered by Trees and Forests next to their materials' `positionNode`; read only by
 * a scene pass that asks for a velocity channel (`windVelocityMRT` in `@casmo/tree.js/scene`). The
 * materials themselves are never changed for it.
 */
export interface WindMotion {
  /** The Wind (or binding) the material sways with: its clock gives the current Wind time. */
  readonly source: WindSource;
  /**
   * TSL node: where each vertex was at Wind time `previous` relative to where it is now, in the
   * space `positionNode` outputs (the shader's `positionLocal`). Only Wind: Growth and Season are
   * the current ones (they are not motion).
   */
  shift(previous: Node<'float'>): Node<'vec3'>;
  /**
   * TSL node: the current Wind displacement of each vertex, in the space `positionNode` outputs (only
   * attributes and uniforms). Tree Shader Hooks turn the smooth normal with it (the swayed normal).
   */
  readonly offset?: Node<'vec3'>;
}

// Keyed by the material's positionNode, so material clones (which share it) move the same, and a
// replaced positionNode (no longer ours) falls back to three's own velocity. Limitation: an app that
// replaces a tree material's positionNode (even with one that wraps ours) drops its Wind velocity:
// TRAA may then ghost and motion blur miss the sway of those trees.
const motions = new WeakMap<Node, WindMotion>();

/** Registers the Wind motion of the materials drawn with `positionNode`. */
export function setWindMotion(positionNode: Node, motion: WindMotion): void {
  motions.set(positionNode, motion);
}

/** The Wind motion of a material's `positionNode`, if it is a tree.js tree position. */
export function windMotionOf(positionNode: Node | null | undefined): WindMotion | undefined {
  return positionNode ? motions.get(positionNode) : undefined;
}

/** The Wind time (seconds) a source shows at renderer time `frameTime`: its pinned time, or the clock. */
export function windTimeOf(source: WindSource, frameTime: number): number {
  const wind = source instanceof WindBinding ? source.wind : source instanceof Wind ? source : null;
  return wind?.time ?? frameTime;
}
