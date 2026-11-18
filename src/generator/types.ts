export type Vec3 = [number, number, number];

/** One point on a branch's centre line. */
export interface SkeletonPoint {
  position: Vec3;
  radius: number;
}

/**
 * One branch of the skeleton. `path` is stable for a given Definition and Seed
 * (ADR 0003): the trunk is "0", its children "0.0", "0.1", ... (ticket #4). Extra Stems are "1", "2", ...
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

/**
 * One Fruit (ADR 0006). `id` is `<branch path>/<index>`, stable for a given Definition and Seed.
 */
export interface SkeletonFruit {
  id: string;
  /** Path of the (outermost) branch the Fruit grows on. */
  branch: string;
  /** Index of the Fruit on its branch (0 nearest the branch base). */
  index: number;
  /** Where the Fruit sits on its branch, as a fraction (0..1) of the branch length. */
  attach: number;
  /** Attachment point on the branch centre line (the top of the Fruit). */
  position: Vec3;
  /** Unit vector from the attachment point through the Fruit (down for hanging Fruit). */
  direction: Vec3;
  /** A unit vector perpendicular to `direction` (orients the Fruit's shape). */
  normal: Vec3;
  /** Fruit length (attachment to far end). */
  size: number;
  /** The Seed's colour variation for this Fruit (RGB multiplier, as for leaves); also its vertex colour. */
  tint: Vec3;
}

export interface TreeSkeleton {
  /** Stems (trunks) first, then breadth first: all of level 1, all of level 2, ... */
  branches: SkeletonBranch[];
  leaves: SkeletonLeaf[];
  /** Fruit on the outermost twigs (empty without a `fruit` block). */
  fruit: SkeletonFruit[];
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
  /** Part level: 0 = trunk, n = branching level n, leaves = number of branch levels + 1, Fruit = levels + 2. */
  aLevel: VertexAttribute;
  /** Position of the vertex along its part, 0 at the base to 1 at the tip. */
  aAlong: VertexAttribute;
  /** Where the part sits on its parent (0..1 of the parent's length); 0 for the trunk. */
  aAttach: VertexAttribute;
  /** Stable random number per part (0..1), from the Seed and the branch path / leaf id. */
  aRandom: VertexAttribute;
  /** Base point of the part (vec3): pivot for growing and swaying it. */
  aOrigin: VertexAttribute;
  /**
   * Growth (vec3): x = Growth at which the part starts to sprout, y = Growth at which it is fully
   * grown (its window, see `TreeData.growth`), z = distance of the vertex from the part's centre
   * line (the branch radius there; 0 for leaves and branch tips), used to thicken over Growth.
   */
  aGrowth: VertexAttribute;
  /**
   * Season (vec3): x = timing shift from the Seed (within ± `variation.season`), y = coverage rank,
   * z = blossom rank (0..1, leaves only; 0 on wood). See `leafSeason` in src/season.
   * On Fruit: y = the Fruit's rank, z = 0 (see `fruitSeason`).
   */
  aSeason: VertexAttribute;
  /**
   * Wind weights (vec3, each 0..1): x = trunk sway (pinned at the ground, 1 at the trunk top),
   * y = branch sway (0 on the trunk, rising towards the outermost twigs), z = leaf flutter (0 on wood,
   * 0 at a leaf base, 1 at its tip). Fruit has its twig's branch sway at the attachment point and no flutter. See `generator/wind.ts`.
   */
  aWind: VertexAttribute;
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

/** The span of Growth (0..1) over which one part grows from nothing to full size. */
export interface GrowthWindow {
  start: number;
  end: number;
}

/** Growth windows per part, parallel to `TreeSkeleton.branches`, `.leaves` and `.fruit`. */
export interface GrowthTiming {
  branches: GrowthWindow[];
  leaves: GrowthWindow[];
  /** Fruit grows only at the end of Growth (from about 0.9), on a fully grown twig. */
  fruit: GrowthWindow[];
}

/** Everything the Generator produces for one Definition + Seed. Pure data, Node-safe. */
export interface TreeData {
  seed: number;
  skeleton: TreeSkeleton;
  /** Wood mesh: trunk and all branches. */
  wood: GeometryBuffers;
  /** Leaf cards, vertex coloured. Empty buffers for a bare tree. */
  leaves: GeometryBuffers;
  /** Fruit solids, vertex coloured (the Seed's tint). Empty buffers without Fruit. */
  fruit: GeometryBuffers;
  /** When each part grows (the Seed shifts it within `variation.growth`). Also in the `aGrowth` attribute. */
  growth: GrowthTiming;
}
