// Fantasy Styles (ADR 0017): what Whimsical and Enchanted add on top of the look `draw` gives a tree.
// A Fantasy Style writes its own Twist recipe onto the trunk and every branch level (overwriting any
// Twist in the source, keeping every other shape field), its own bark colour, and its own Leaf Palettes
// and Season leaf colours, re-timed to the source's leaf coverage so the Species keeps its Season timing.
// Other Styles never call this, so re-styling a fantasy tree in them keeps all of it (it is plain
// Definition data that `draw` passes through).
import type {
  BranchLevelDefinition,
  HexColor,
  InnerGlowDefinition,
  Keyframe,
  LeafPalette,
  Spin,
  TreeDefinition,
  TreeForm,
  TwistStyle,
} from '../definition/types';

/** The full Twist of the trunk or a branch level: every field set, so it overwrites the source's. */
export interface FantasyTwist {
  twist: number;
  twists: number;
  twistStyle: TwistStyle;
  spin: Spin;
  twistCurve: number;
}

/** The Twist of a branch level, with its Follow Twist. */
export interface FantasyLevelTwist extends FantasyTwist {
  followTwist: boolean;
}

/** A Fantasy Style's Twist for one Form, per depth. */
export interface FantasyTwistRecipe {
  trunk: FantasyTwist;
  /** The first branch level (a conifer's whorls). */
  level1: FantasyLevelTwist;
  /** Every deeper branch level. */
  deeper: FantasyLevelTwist;
}

/**
 * One Leaf Palette of a Fantasy Style: its leaf colour at three moments of the Season, and its accent.
 * {@link fantasySeason} times them to the source's leaf coverage.
 */
export interface FantasyPalette {
  /** Leaf-out (Season 0 and the last day of winter). */
  spring: HexColor;
  /** Full leaf, from leaf-out until the leaves start to fall. */
  summer: HexColor;
  /** While the leaves fall, held until the end of winter. */
  autumn: HexColor;
  /** The Leaf Palette's accent colour (e.g. the `whimsical` bark stripe). */
  accent: HexColor;
}

/** Everything a Fantasy Style writes onto a tree besides its look (see ADR 0017). */
export interface FantasyRecipe {
  twist: Record<TreeForm, FantasyTwistRecipe>;
  /** The bark colour (replaces the source's). */
  barkColor: HexColor;
  /**
   * The Leaf Palettes (at least one; the first one is also the Season Profile's `leafColor`), for a
   * source that drops its leaves or for an evergreen one (its leaf coverage never falls).
   */
  palettes(evergreen: boolean): FantasyPalette[];
  /** The Style's Inner Glow (replaces the source's); absent = the Style has none and drops the source's. */
  innerGlow?: InnerGlowDefinition;
}

/** The Season moments a palette's leaf colours are timed to (see `leafTiming`). */
export interface LeafTiming {
  full: number;
  fall: number;
  bare: number;
}

/** When an evergreen holds its colours: the Stylized evergreen's timing. */
const EVERGREEN_TIMING: LeafTiming = { full: 0.2, fall: 0.55, bare: 0.75 };

/**
 * The Season moments a palette is timed to, from the leaf coverage track: `full` when the leaves are
 * first fully out, `fall` when they start to drop, `bare` when the coverage reaches its lowest. A track
 * whose coverage never falls is an evergreen's.
 */
export function leafTiming(coverage: Keyframe<number>[]): LeafTiming & { evergreen: boolean } {
  const values = coverage.map((k) => k.value);
  const max = Math.max(...values);
  const full = coverage.findIndex((k) => k.value === max);
  let fall = full;
  while (fall + 1 < coverage.length && coverage[fall + 1]!.value === max) fall++;
  const after = coverage.slice(fall + 1);
  if (!after.length) return { ...EVERGREEN_TIMING, evergreen: true };
  const min = Math.min(...after.map((k) => k.value));
  const bare = after.find((k) => k.value === min)!;
  return { full: coverage[full]!.t, fall: coverage[fall]!.t, bare: bare.t, evergreen: false };
}

/** A palette's leaf colour keyframes: spring at Season 0, summer while full, autumn as the leaves fall. */
function leafColorOf(palette: FantasyPalette, { full, fall, bare }: LeafTiming): Keyframe<HexColor>[] {
  // The leaves warm up over the first part of their fall and keep that colour until the end of winter.
  const turned = fall + (bare - fall) * 0.4;
  const hold = Math.max(turned, 0.97);
  return [
    { t: 0, value: palette.spring },
    { t: full, value: palette.summer },
    { t: fall, value: palette.summer },
    { t: turned, value: palette.autumn },
    { t: hold, value: palette.autumn },
    { t: 1, value: palette.spring },
  ];
}

/**
 * The Season Profile of `season` in a Fantasy Style: its Leaf Palettes and leaf colours replaced by the
 * recipe's, timed to its own leaf coverage; coverage, blossom and Fruit are kept.
 */
export function fantasySeason(recipe: FantasyRecipe, season: TreeDefinition['season']): TreeDefinition['season'] {
  const timing = leafTiming(season.leafCoverage);
  const leafPalettes: LeafPalette[] = recipe
    .palettes(timing.evergreen)
    .map((palette) => ({ leafColor: leafColorOf(palette, timing), accent: palette.accent }));
  return { ...season, leafColor: leafPalettes[0]!.leafColor, leafPalettes };
}

/**
 * Writes a Fantasy Style's recipe onto a Definition drawn in its look: the Twist per depth for the tree's
 * Form, the bark colour, the Season leaf colours and Leaf Palettes, and the Inner Glow (dropped when the
 * Style has none, so switching Enchanted -> Whimsical leaves no glow behind). Every other field is kept. Pure.
 */
export function applyFantasy(recipe: FantasyRecipe, definition: TreeDefinition, form: TreeForm): TreeDefinition {
  const twist = recipe.twist[form];
  const materials = { ...definition.materials };
  delete materials.innerGlow;
  return {
    ...definition,
    trunk: { ...definition.trunk, ...twist.trunk },
    branches: definition.branches.map((level, i): BranchLevelDefinition => ({ ...level, ...(i === 0 ? twist.level1 : twist.deeper) })),
    materials: {
      ...materials,
      bark: { ...definition.materials.bark, color: recipe.barkColor },
      ...(recipe.innerGlow && { innerGlow: { ...recipe.innerGlow } }),
    },
    season: fantasySeason(recipe, definition.season),
  };
}
