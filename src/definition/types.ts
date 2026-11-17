/** Current Tree Definition schema version. Bump (with a migration) when the format changes. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Trunk parameters. Lengths are in metres (scene units). */
export interface TrunkDefinition {
  /** Trunk length at full Growth. */
  length: number;
  /** Radius at the base. */
  radius: number;
  /** Tip radius as a fraction of the base radius (0 = point, 1 = cylinder). */
  taper: number;
  /** Number of sides around the trunk (>= 3). */
  sides: number;
  /** Number of sections along the trunk (>= 1). */
  sections: number;
  /** Seed range: the Seed scales length by up to ± this fraction (0..1). */
  lengthVariation: number;
  /** Seed range: maximum sideways drift per section, as a fraction of the section length (0..1). */
  bend: number;
}

export interface BarkDefinition {
  /** Base bark colour, `#rrggbb`. */
  color: string;
}

/**
 * One branching level: how the branches of the level above sprout children.
 * `branches[0]` grows from the trunk, `branches[1]` from those branches, and so on.
 */
export interface BranchLevelDefinition {
  /** Children per parent branch. */
  count: number;
  /** Seed range: the Seed scales `count` by up to ± this fraction (0..1), rounded. */
  countVariation: number;
  /** Where children start along the parent, as a fraction of its length (0..1); they spread up to its tip. */
  start: number;
  /** Child length as a fraction of the parent's length. */
  length: number;
  /** Seed range: the Seed scales each child's length by up to ± this fraction (0..1). */
  lengthVariation: number;
  /** Child base radius as a fraction of the parent's radius where it attaches (0..1). */
  radius: number;
  /** Tip radius as a fraction of the base radius (0..1). */
  taper: number;
  /** Angle between parent and child, in degrees (0..180). */
  angle: number;
  /** Seed range: the Seed changes `angle` by up to ± this many degrees (0..180). */
  angleVariation: number;
  /** Seed range: how much the branch wanders per section (0..1). */
  bend: number;
  /** Sides around each branch (>= 3). */
  sides: number;
  /** Sections along each branch (>= 1). */
  sections: number;
}

/** Leaves: cards on the branches of the last branching level (or the trunk if there are none). */
export interface LeavesDefinition {
  /** Leaves per outermost branch (0 = bare tree). */
  count: number;
  /** Where leaves start along their branch (0..1); they spread up to its tip. */
  start: number;
  /** Leaf length in metres. */
  size: number;
  /** Seed range: the Seed scales each leaf's size by up to ± this fraction (0..1). */
  sizeVariation: number;
  /** Base leaf colour, `#rrggbb`. */
  color: string;
  /** Seed range: each colour channel varies by up to ± this fraction of the base colour (0..1). */
  colorVariation: number;
}

/**
 * The full parameter set that describes how a tree is generated, independent of any Seed.
 * Plain JSON: it is what the Tree Editor exports.
 */
export interface TreeDefinition {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  trunk: TrunkDefinition;
  bark: BarkDefinition;
  /** Branching levels below the trunk, outermost last. */
  branches: BranchLevelDefinition[];
  leaves: LeavesDefinition;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** What callers may pass: `schemaVersion` plus any subset of the fields; the rest is defaulted. */
export type TreeDefinitionInput = { schemaVersion: number } & DeepPartial<Omit<TreeDefinition, 'schemaVersion'>>;
