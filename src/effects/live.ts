import type { Node } from 'three/webgpu';

/**
 * A built Tree Effect whose colours and numbers are uniforms: `update()` changes them in place
 * (no new graph, no recompile). Settings that change the graph itself (its shape) need a new build.
 */
export interface LiveTreeEffect<Options> {
  /** The resulting colour node. */
  node: Node<'vec4'>;
  /** Sets the uniforms to `options` (the shape-defining settings are ignored). */
  update(options: Options): void;
}
