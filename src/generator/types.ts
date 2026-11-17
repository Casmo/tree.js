export type Vec3 = [number, number, number];

/** One point on a branch's centre line. */
export interface SkeletonPoint {
  position: Vec3;
  radius: number;
}

/**
 * One branch of the skeleton. `path` is stable for a given Definition and Seed
 * (ADR 0003): the trunk is "0", its children "0.0", "0.1", ... (ticket #4).
 */
export interface SkeletonBranch {
  path: string;
  /** Path of the parent branch, or null for the trunk. */
  parent: string | null;
  /** 0 = trunk, 1 = first branching level, ... */
  level: number;
  points: SkeletonPoint[];
}

export interface TreeSkeleton {
  branches: SkeletonBranch[];
}

/**
 * Plain geometry buffers (no three.js types), ready to wrap in a BufferGeometry.
 * Later tickets add per-vertex attributes (Growth, Season, Wind) under `attributes`.
 */
export interface GeometryBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Everything the Generator produces for one Definition + Seed. Pure data, Node-safe. */
export interface TreeData {
  seed: number;
  skeleton: TreeSkeleton;
  /** Wood (trunk and branches) mesh. Leaves get their own buffers in ticket #4. */
  geometry: GeometryBuffers;
}
