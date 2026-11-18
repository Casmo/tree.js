import type {
  BarkType,
  BranchLevelDefinition,
  FruitDefinition,
  HexColor,
  LeafType,
  SeasonProfileDefinition,
  TreeForm,
  TrunkDefinition,
  VariationDefinition,
  WindResponseDefinition,
} from '../definition/types';

/**
 * A Species' trunk: the shape fields of {@link TrunkDefinition}, without the polygon detail
 * (`sides`, `sections`, `flareSections`), which the Style chooses. Fields beyond the five required ones (e.g. Stems)
 * are optional and default like in a Tree Definition.
 */
export type SpeciesTrunkDefinition = Pick<TrunkDefinition, 'length' | 'radius' | 'taper' | 'lengthVariation' | 'bend'> &
  Partial<Omit<TrunkDefinition, 'sides' | 'sections' | 'flareSections'>>;

/** A Species' branch level: {@link BranchLevelDefinition} (with its Crown Shape curves) without `sides` / `sections`. */
export type SpeciesBranchLevelDefinition = Omit<BranchLevelDefinition, 'sides' | 'sections'>;

/** A Species' foliage, Style-neutral: the Style turns it into leaf shape, count, size and texture. */
export interface SpeciesFoliageDefinition {
  /** Leaf Type. */
  type: LeafType;
  /** How dense the foliage is, 0 (none) .. 1 (very dense); 0.5 is an ordinary crown. */
  density: number;
  /** Real size of one leaf spray (a cluster of leaves on a twig), metres (> 0). */
  size: number;
  /** Seed range: ± this fraction of `size` (0..1). */
  sizeVariation: number;
  /** Where along the terminal branch leaves start, as a fraction of its length (0..1). */
  start: number;
  /** Angle between branch and leaf, degrees (0..180). */
  angle: number;
}

/** A Species' bark, Style-neutral. */
export interface SpeciesBarkDefinition {
  /** Bark Type. */
  type: BarkType;
  /** Bark colour (the tint for textured bark). */
  color: HexColor;
}

/**
 * A Species' Fruit (ADR 0006), copied as is into the Tree Definition's `fruit` block;
 * the Style decides how it is drawn (its shading).
 */
export type SpeciesFruitDefinition = FruitDefinition;

/**
 * Species: a named kind of real tree, described once, Style-neutral (ADR 0005). Plain JSON.
 * A Style turns it into an ordinary, complete Tree Definition: `createTree(lowPoly.apply(oak), { seed })`.
 * It holds no shading, polygon detail, textures or Style-specific leaf shape / count.
 */
export interface SpeciesDefinition {
  /** Kebab-case id, e.g. `'douglas-fir'`; kept as the Definition's `species`. */
  id: string;
  /** English display name, e.g. `'Douglas Fir'`; becomes the Definition's `name`. */
  name: string;
  /** Form: a label for grouping Species; it never changes geometry. */
  form: TreeForm;
  trunk: SpeciesTrunkDefinition;
  /** Branch levels below the trunk, with their Crown Shape curves. */
  branches: SpeciesBranchLevelDefinition[];
  foliage: SpeciesFoliageDefinition;
  bark: SpeciesBarkDefinition;
  /** Optional Fruit. */
  fruit?: SpeciesFruitDefinition;
  /** Season Profile (tracks beyond the four required ones are optional and default like in a Tree Definition). */
  season: Pick<SeasonProfileDefinition, 'leafColor' | 'leafCoverage' | 'blossom' | 'blossomColor'> & Partial<SeasonProfileDefinition>;
  wind: WindResponseDefinition;
  variation: VariationDefinition;
}
