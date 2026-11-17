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
 * The full parameter set that describes how a tree is generated, independent of any Seed.
 * Plain JSON: it is what the Tree Editor exports.
 */
export interface TreeDefinition {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  trunk: TrunkDefinition;
  bark: BarkDefinition;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** What callers may pass: `schemaVersion` plus any subset of the fields; the rest is defaulted. */
export type TreeDefinitionInput = { schemaVersion: number } & DeepPartial<Omit<TreeDefinition, 'schemaVersion'>>;
