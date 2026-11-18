/**
 * Tree Definition schema (see GLOSSARY.md). Plain JSON: it is what the Tree Editor exports
 * and what `createTree` consumes. Every field is documented with its unit and allowed range;
 * the runtime rules live in `schema.ts` and the defaults in `defaults.ts`.
 *
 * Conventions: lengths in metres (scene units), angles in degrees, colours as `#rrggbb`,
 * "fraction" fields are 0..1. Fields named `*Variation` are Seed ranges: the Seed picks a
 * value within ± that fraction of the base value.
 */

/**
 * Current Tree Definition schema version. Bump it, and add a migration in `migrations.ts`,
 * whenever the format changes or a generator change would alter existing trees (ADR 0003).
 */
export const CURRENT_SCHEMA_VERSION = 3;

/** `#rrggbb` colour string. */
export type HexColor = string;

/** [x, y, z] */
export type Vec3Tuple = [number, number, number];

/**
 * Form: a label that groups trees (a Style's `broadleaf` / `conifer` Definition). It never
 * changes geometry and is not part of the Tree Definition; a crown's shape comes from its
 * Crown Shape curves (ADR 0004).
 */
export type TreeForm = 'broadleaf' | 'conifer';

/** Trunk parameters (branch level 0). */
export interface TrunkDefinition {
  /** Trunk length at full Growth, metres (> 0). */
  length: number;
  /** Radius at the base, metres (> 0). */
  radius: number;
  /** Tip radius as a fraction of the base radius (0 = point, 1 = cylinder). */
  taper: number;
  /** Number of sides around the trunk (integer >= 3). */
  sides: number;
  /** Number of sections along the trunk (integer >= 1). */
  sections: number;
  /** Seed range: the Seed scales length by up to ± this fraction (0..1). */
  lengthVariation: number;
  /** Seed range: maximum sideways drift per section, as a fraction of the section length (0..1). */
  bend: number;
  /**
   * Number of Stems growing from the ground (integer >= 1). Each Stem is a full trunk with these
   * parameters and the full branch structure; Stem paths are "0", "1", "2", ... Absent = 1 (a single trunk).
   */
  stems?: number;
  /**
   * How far each Stem leans out from vertical, degrees (0..90). The Seed varies it per Stem
   * (± 30 %) and turns the ring of Stems. Absent = 0 (upright).
   */
  spread?: number;
  /**
   * Pull on the leader, the upper third of each Stem (−1..1): − makes it nod over (a hemlock's
   * drooping tip), + pulls a leaning Stem back up. The lower trunk is never bent. Absent = 0 (none).
   */
  gravity?: number;
  /**
   * Root Flare (0..1): how much each Stem widens towards the ground over the bottom of its length.
   * 1 makes the base ring 1.8 × the trunk radius. Geometry only (ADR 0007): branches, leaves, Fruit,
   * Growth, Wind and Sculpts never move. Absent = 0 (none).
   */
  flare?: number;
  /**
   * Number of extra sections the trunk sweep puts in the Root Flare (integer >= 1), set by the Style
   * like `sides` and `sections`: 2 in low-poly, 3 in the others. Unused without flare. Absent = 3.
   */
  flareSections?: number;
}

/**
 * One level of branching. `branches[0]` grows from the trunk, `branches[1]` from the
 * level-1 branches, and so on (at most {@link MAX_BRANCH_LEVELS} levels).
 */
export interface BranchLevelDefinition {
  /** Child branches per parent branch (integer >= 0). */
  count: number;
  /** Where along the parent children start, as a fraction of the parent length (0..1). */
  start: number;
  /** Where along the parent children stop, as a fraction of the parent length (0..1, >= start). */
  end: number;
  /** Angle between parent and child direction, degrees (0..180). */
  angle: number;
  /** Seed range: ± this fraction of `angle` (0..1). */
  angleVariation: number;
  /** Rotation around the parent between successive children, degrees (0..360; 137.5 = golden angle). */
  spiral: number;
  /** Child length as a fraction of the parent's length (> 0). */
  length: number;
  /** Seed range: ± this fraction of `length` (0..1). */
  lengthVariation: number;
  /** Child base radius as a fraction of the parent's radius where it attaches (0..1). */
  radius: number;
  /** Tip radius as a fraction of the base radius (0..1). */
  taper: number;
  /** Number of sides around each branch (integer >= 3). */
  sides: number;
  /** Number of sections along each branch (integer >= 1). */
  sections: number;
  /** Seed range: maximum sideways drift per section, as a fraction of the section length (0..1). */
  bend: number;
  /** Upward (+) or downward (−) pull on the branch tip (−1..1). */
  gravity: number;
  /**
   * Crown Shape: multiplies `length` by the attach position on the parent (`t` 0 = base .. 1 = tip),
   * values >= 0. Linear between keyframes, holding the first/last value outside them. Absent = flat (1).
   * E.g. a cone: `[{ t: start, value: 1 }, { t: 1, value: 0.1 }]`.
   */
  lengthProfile?: Keyframe<number>[];
  /** Crown Shape: multiplies `angle` by the attach position on the parent, like `lengthProfile` (values >= 0; the angle stays <= 180). */
  angleProfile?: Keyframe<number>[];
}

/** Maximum number of branching levels below the trunk. */
export const MAX_BRANCH_LEVELS = 4;

/**
 * How a leaf is drawn: a flat card, a faceted clump of foliage, a needle cluster, or a puff
 * (a smooth round ball of foliage, for toon shading).
 */
export type LeafShape = 'card' | 'clump' | 'needle' | 'puff';

/**
 * Leaf Type: the kind of leaf a Species has. Each Style decides how to draw it (leaf shape,
 * count, size, texture); in a Tree Definition it is a label that never changes geometry by itself.
 */
export type LeafType = 'broad' | 'lobed' | 'palmate' | 'compound' | 'needle' | 'scale';
/** All Leaf Types. */
export const LEAF_TYPES: readonly LeafType[] = ['broad', 'lobed', 'palmate', 'compound', 'needle', 'scale'];

/**
 * Bark Type: the kind of bark surface a Species has. Each Style decides how to draw it (colour
 * only, or a texture); in a Tree Definition it is a label that never changes geometry by itself.
 */
export type BarkType = 'furrowed' | 'smooth' | 'papery' | 'fibrous' | 'plated';
/** All Bark Types. */
export const BARK_TYPES: readonly BarkType[] = ['furrowed', 'smooth', 'papery', 'fibrous', 'plated'];

/** Leaves, placed on the last branching level (or the trunk if there are no branches). */
export interface LeavesDefinition {
  /** Leaf Type the leaves were drawn from (set by `Style.apply`), so a Style can be re-applied. Optional. */
  type?: LeafType;
  /** Leaves per terminal branch (integer >= 0; 0 = no leaves). */
  count: number;
  /** Leaf shape. */
  shape: LeafShape;
  /** Leaf size (width and length of a card / clump diameter), metres (> 0). */
  size: number;
  /** Seed range: ± this fraction of `size` (0..1). */
  sizeVariation: number;
  /** Where along the terminal branch leaves start, as a fraction of its length (0..1). */
  start: number;
  /** Angle between branch and leaf, degrees (0..180). */
  angle: number;
}

/**
 * Fruit Type: the kind of Fruit a tree bears. `round` (apple, cherry, plum), `pear`, `nut` (a
 * spiky husk, e.g. chestnut), `cone` (conifer cones) or `berry` (small, e.g. juniper).
 */
export type FruitType = 'round' | 'pear' | 'nut' | 'cone' | 'berry';

/** Every Fruit Type. */
export const FRUIT_TYPES: readonly FruitType[] = ['round', 'pear', 'nut', 'cone', 'berry'];

/**
 * Fruit (ADR 0006): its own tree part, grown on the outermost twigs (the trunk if there are no
 * branch levels) from its own random stream, drawn as small solid shapes in the `fruit` mesh.
 * Absent = no Fruit. Season comes from the Season Profile's `fruit` and `fruitColor` tracks.
 */
export interface FruitDefinition {
  /** Fruit Type (shape). */
  type: FruitType;
  /**
   * Fruit per outermost twig (>= 0). A fraction is a chance: 0.3 = one Fruit on about 30% of the
   * twigs, 1.5 = one on every twig and a second on about half (which twigs comes from the Seed).
   */
  count: number;
  /** Fruit length (and about its diameter), metres (> 0). */
  size: number;
  /** Seed range: ± this fraction of `size` (0..1). */
  sizeVariation: number;
  /** How far the Fruit dangles below its twig (0 = sits on the twig pointing outward .. 1 = hangs straight down). */
  hang: number;
  /**
   * Polygon detail, set by the Style: faces around each Fruit (3..16). 5 or fewer also gives a coarse
   * profile (a few flat facets, low-poly). Absent = the Fruit Type's own smooth template.
   */
  sides?: number;
}

/**
 * Roots (ADR 0007): their own tree part, grown after the Sculpt pass from the Root Flare of every
 * remaining Stem, each from its own random stream, and drawn in the wood mesh after the branches.
 * They run outward and down, taper to a point below the ground, grow with the trunk and never sway.
 * They are not Sculptable. Absent = no Roots.
 */
export interface RootsDefinition {
  /** Roots per Stem (integer 0..12). */
  count: number;
  /** Root length as a fraction of its Stem's length (after Seed variation and Sculpts), 0..1. */
  length: number;
  /** Seed range: ± this fraction of `length` (0..1). */
  lengthVariation: number;
  /** Base radius as a fraction of the trunk's base radius (0..1). */
  radius: number;
  /** How steeply a Root dives, degrees below horizontal (0..60). Every Root still ends below the ground. */
  angle: number;
  /** Seed range: sideways wander per section (0..1). */
  bend: number;
  /** Polygon detail, set by the Style: sides around each Root (integer 3..16). Absent = derived from `trunk.sides`. */
  sides?: number;
  /** Polygon detail, set by the Style: sections along each Root (integer >= 1). Absent = 4. */
  sections?: number;
}

/** Material shading model. Low-poly uses `flat`, stylized `toon`, realistic `standard`. */
export type Shading = 'standard' | 'flat' | 'toon';

export interface BarkMaterialDefinition {
  /** Bark Type the bark was drawn from (set by `Style.apply`), so a Style can be re-applied. Optional. */
  type?: BarkType;
  /** Base bark colour. */
  color: HexColor;
  /** PBR roughness (0..1). */
  roughness: number;
  /** Colour texture URL (resolved against the app's texture base path), or null for none. */
  map: string | null;
  /** Normal map URL, or null for none. */
  normalMap: string | null;
  /** Ground Tint: a darker or mossy bark colour near the ground. Optional; absent = none. */
  groundTint?: GroundTintDefinition;
}

/**
 * Ground Tint: at and below the ground (tree-space height <= 0, measured on the grown tree) the
 * bark colour blends towards `color` by `strength`; the blend fades smoothly to nothing at `height`.
 */
export interface GroundTintDefinition {
  /** The colour the bark blends towards near the ground. */
  color: HexColor;
  /** Metres above the ground where the tint has faded out (> 0). */
  height: number;
  /** How far the bark blends towards `color` at the ground (0..1). */
  strength: number;
}

export interface LeafMaterialDefinition {
  /** PBR roughness (0..1). Leaf colour comes from the Season Profile. */
  roughness: number;
  /** Leaf card texture URL (alpha cut-out), or null for none. */
  map: string | null;
  /** Alpha cut-off for `map` (0..1). */
  alphaTest: number;
  /**
   * Crown Normals (a Material Feature, ADR 0008): how far each leaf's normal bends towards the
   * Crown Volume's normal, 0 (each leaf lit on its own) .. 1 (the crown lit as one shape). Absent or 0 = off.
   */
  crownNormals?: number;
  /** Leaf Translucency (a Material Feature, ADR 0008). Absent = off. */
  translucency?: TranslucencyDefinition;
}

/**
 * Leaf Translucency: light shining through the leaves towards the viewer makes them glow in their
 * own (Season) colour, more at the thin edge of the crown. All plain numbers, 0..1.
 */
export interface TranslucencyDefinition {
  /** How strongly leaves with a direct light behind them glow (0..1). */
  strength: number;
  /** Extra glow at the thin edge of the Crown Volume (0 = the same everywhere .. 1 = only at the edge). */
  edge: number;
  /** The indirect (sky) part shining through the canopy, dimmed by occlusion (0..1). */
  ambient: number;
}

/** Structural Occlusion: ambient light darkened where the tree hides itself (wood, leaves and Fruit). */
export interface OcclusionDefinition {
  /** How far the baked occlusion darkens ambient and indirect light (0 = none .. 1 = fully). */
  strength: number;
}

/**
 * The three Material Features (GLOSSARY, ADR 0008), with the same shapes as in a Definition
 * (`materials.leaf.crownNormals`, `materials.leaf.translucency`, `materials.occlusion`). Absent = off.
 */
export interface MaterialFeatures {
  crownNormals?: number;
  translucency?: TranslucencyDefinition;
  occlusion?: OcclusionDefinition;
}

export interface MaterialsDefinition {
  shading: Shading;
  bark: BarkMaterialDefinition;
  leaf: LeafMaterialDefinition;
  /** Structural Occlusion (a Material Feature, ADR 0008). Absent = off. */
  occlusion?: OcclusionDefinition;
}

/**
 * One keyframe of a track. In a Season Profile `t` is the Season (0 = first day of spring .. 1 = last
 * day of winter); in a Crown Shape curve it is the attach position on the parent branch (0 = base .. 1 = tip).
 */
export interface Keyframe<V> {
  t: number;
  value: V;
}

/**
 * How leaf colour, leaf coverage and blossom change across Season. Each track needs
 * at least one keyframe; keyframes are sorted by `t` (non-decreasing).
 */
export interface SeasonProfileDefinition {
  /** Leaf colour keyframes. */
  leafColor: Keyframe<HexColor>[];
  /** Leaf coverage keyframes (0 = bare .. 1 = full). */
  leafCoverage: Keyframe<number>[];
  /** Blossom amount keyframes (0 = none .. 1 = full bloom). */
  blossom: Keyframe<number>[];
  /** Blossom colour. */
  blossomColor: HexColor;
  /**
   * Fruit amount keyframes (0 = none .. 1 = all Fruit at full size); each Fruit shows while the amount
   * is above its own rank and swells with the amount. Absent = 1 all year. Only used with `fruit`.
   */
  fruit?: Keyframe<number>[];
  /** Fruit colour keyframes (ripening). Absent = a red (`DEFAULT_FRUIT_COLOR`) all year. Only used with `fruit`. */
  fruitColor?: Keyframe<HexColor>[];
}

/** Per-tree response to the scene-wide Wind. All 0 (stiff) .. 1 (very flexible). */
export interface WindResponseDefinition {
  /** Sway of the trunk. */
  trunk: number;
  /** Sway of the branches. */
  branches: number;
  /** Flutter of the leaves. */
  leaves: number;
  /** Sway speed multiplier (> 0; 1 = default). */
  frequency: number;
}

/** Seed ranges that are not tied to one tree part. All 0 (none) .. 1. */
export interface VariationDefinition {
  /** How much the Seed shifts bark and leaf colours. */
  color: number;
  /** How much the Seed shifts the timing of Growth (fraction of the 0..1 range). */
  growth: number;
  /** How much the Seed shifts the timing of Season (fraction of the 0..1 range). */
  season: number;
}

interface SculptBase {
  /** The Seed the Sculpt was made on; every other Seed ignores it (ADR 0003). */
  seed: number;
  /** Branch path, e.g. "0" (trunk / first Stem), "1" (second Stem) or "0.3.1". */
  path: string;
}
/** Removes a branch and everything growing from it. */
export interface DeleteSculpt extends SculptBase {
  action: 'delete';
}
/** Rotates (Euler XYZ, radians) and scales a branch around its base. */
export interface MoveSculpt extends SculptBase {
  action: 'move';
  rotation: Vec3Tuple;
  /** Length scale (> 0). */
  scale: number;
}
/** Sets the leaf coverage (0..1) of a branch and everything growing from it. */
export interface LeavesSculpt extends SculptBase {
  action: 'leaves';
  coverage: number;
}
/** A hand edit made in the Tree Editor, tied to one Seed. */
export type Sculpt = DeleteSculpt | MoveSculpt | LeavesSculpt;

/**
 * The full parameter set that describes how a tree is generated, independent of any Seed.
 */
export interface TreeDefinition {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  /** Optional human-readable name. */
  name: string;
  /** Id of the Species this Definition was made from by `Style.apply` (e.g. `'oak'`). Optional; never changes geometry. */
  species?: string;
  trunk: TrunkDefinition;
  /** Branching levels below the trunk (0..{@link MAX_BRANCH_LEVELS} entries). */
  branches: BranchLevelDefinition[];
  leaves: LeavesDefinition;
  /** Fruit on the outermost twigs; absent = none. */
  fruit?: FruitDefinition;
  /** Roots on every Stem; absent = none. */
  roots?: RootsDefinition;
  materials: MaterialsDefinition;
  season: SeasonProfileDefinition;
  wind: WindResponseDefinition;
  variation: VariationDefinition;
  sculpts: Sculpt[];
}

/**
 * Deep partial for Definition input. Objects may omit fields (they get defaults); arrays
 * replace the default array as a whole. Branch levels may be partial (missing fields come
 * from {@link DEFAULT_BRANCH_LEVEL}); keyframes and Sculpts must be complete.
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? (U extends Keyframe<unknown> | Sculpt ? U : DeepPartial<U>)[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * What callers may pass: `schemaVersion` plus any subset of the fields; the rest is defaulted.
 * Older `schemaVersion`s are accepted and migrated.
 */
export type TreeDefinitionInput = { schemaVersion: number } & DeepPartial<Omit<TreeDefinition, 'schemaVersion'>>;
