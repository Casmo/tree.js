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

/**
 * One leaf. `id` is `<branch path>/<index>`, stable for a given Definition and Seed,
 * so leaf Sculpts (painting) can address it.
 */
export interface SkeletonLeaf {
  id: string;
  /** Path of the branch the leaf grows on. */
  branch: string;
  /** Index of the leaf on its branch (0 nearest the branch base). */
  index: number;
  /** Attachment point on the branch centre line. */
  position: Vec3;
  /** Unit vector from the attachment point to the leaf tip. */
  direction: Vec3;
  /** Unit normal of the leaf card's front face. */
  normal: Vec3;
  /** Leaf length (base to tip). */
  size: number;
  /** Leaf colour, sRGB channels 0..1 (the geometry's `colors` hold the linear values). */
  color: Vec3;
}

export interface TreeSkeleton {
  /** Trunk first, then breadth first: all of level 1, all of level 2, ... */
  branches: SkeletonBranch[];
  leaves: SkeletonLeaf[];
}

/**
 * Plain geometry buffers (no three.js types), ready to wrap in a BufferGeometry.
 * Later tickets add per-vertex attributes (Growth, Season, Wind) under `attributes`.
 */
export interface GeometryBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Optional per-vertex colours, linear RGB (leaves). */
  colors?: Float32Array;
  indices: Uint32Array;
}

/** Everything the Generator produces for one Definition + Seed. Pure data, Node-safe. */
export interface TreeData {
  seed: number;
  skeleton: TreeSkeleton;
  /** Wood mesh: trunk and all branches. */
  wood: GeometryBuffers;
  /** Leaf cards, vertex coloured. Empty buffers for a bare tree. */
  leaves: GeometryBuffers;
}
