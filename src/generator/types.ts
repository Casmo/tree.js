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
  /** Where the branch sits on its parent, as a fraction (0..1) of the parent's length; 0 for the trunk. */
  attach: number;
  /** Unit direction the branch leaves its parent in (before bend and gravity); straight up for the trunk. */
  direction: Vec3;
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
  /** Where the leaf sits on its branch, as a fraction (0..1) of the branch length. */
  attach: number;
  /** Attachment point on the branch centre line. */
  position: Vec3;
  /** Unit vector from the attachment point to the leaf tip. */
  direction: Vec3;
  /** Unit normal of the leaf card's front face. */
  normal: Vec3;
  /** Leaf length (base to tip). */
  size: number;
  /**
   * The Seed's colour variation for this leaf: an RGB multiplier, each channel within
   * 1 ± the Definition's `variation.color`. The leaf material multiplies its (Season) colour
   * by it; the geometry's vertex `colors` hold the same values.
   */
  tint: Vec3;
}

export interface TreeSkeleton {
  /** Trunk first, then breadth first: all of level 1, all of level 2, ... */
  branches: SkeletonBranch[];
  leaves: SkeletonLeaf[];
}

/** A custom per-vertex attribute: `itemSize` floats per vertex. */
export interface VertexAttribute {
  array: Float32Array;
  itemSize: number;
}

/**
 * Per-vertex attributes every tree mesh carries; Growth, Season and Wind (tickets #6-#8)
 * are computed from these in TSL, and may add their own entries.
 * A "part" is a branch (wood mesh) or a leaf (leaves mesh).
 */
export interface TreeAttributes {
  [name: string]: VertexAttribute;
  /** Part level: 0 = trunk, n = branching level n, leaves = number of branch levels + 1. */
  aLevel: VertexAttribute;
  /** Position of the vertex along its part, 0 at the base to 1 at the tip. */
  aAlong: VertexAttribute;
  /** Where the part sits on its parent (0..1 of the parent's length); 0 for the trunk. */
  aAttach: VertexAttribute;
  /** Stable random number per part (0..1), from the Seed and the branch path / leaf id. */
  aRandom: VertexAttribute;
  /** Base point of the part (vec3): pivot for growing and swaying it. */
  aOrigin: VertexAttribute;
}

/** Plain geometry buffers (no three.js types), ready to wrap in a BufferGeometry. */
export interface GeometryBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Optional per-vertex colours, linear RGB (leaves). */
  colors?: Float32Array;
  indices: Uint32Array;
  attributes: TreeAttributes;
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
