import type { HexColor, Keyframe, SeasonProfileDefinition, VariationDefinition } from '../definition';
import { seedRandom } from '../random';
import { pow } from '../math';

/**
 * Pure JS evaluator of the Season Profile: the CPU twin of the TSL nodes in `./nodes.ts`.
 * No three.js, Node-safe. The Baked Tree export uses it to bake Season into geometry and
 * colours; the shader evaluates exactly the same maths per leaf.
 */

/** Linear RGB, 0..1 per channel. */
export type RGB = [number, number, number];

/** Smallest keyframe span used as a divisor (two keys at the same `t` make a step). */
export const KEYFRAME_EPSILON = 1e-5;

/** Interpolation weight of the segment `t0..t1` at `s` (0 before, 1 after). */
export function segmentWeight(s: number, t0: number, t1: number): number {
  return Math.min(Math.max((s - t0) / Math.max(t1 - t0, KEYFRAME_EPSILON), 0), 1);
}

function mixValue<V extends number | number[]>(a: V, b: V, f: number): V {
  if (typeof a === 'number') return (a + ((b as number) - a) * f) as V;
  return a.map((x, i) => x + ((b as number[])[i]! - x) * f) as V;
}

/**
 * Samples a keyframe track at Season `s`: linear between keys, holding the first value
 * before the first key and the last value after the last one. Computed as a chain of
 * mixes (one per segment), the same chain the shader runs.
 */
export function sampleTrack<V extends number | number[]>(track: readonly Keyframe<V>[], s: number): V {
  let out = track[0]!.value;
  for (let i = 0; i < track.length - 1; i++) {
    out = mixValue(out, track[i + 1]!.value, segmentWeight(s, track[i]!.t, track[i + 1]!.t));
  }
  return out;
}

/** Brings any Season into 0..1: values inside 0..1 (including 1, the last day of winter) are kept, others wrap around the year. */
export function wrapSeason(s: number): number {
  return s >= 0 && s <= 1 ? s : s - Math.floor(s);
}

/** sRGB transfer curve -> linear, per channel (as three.js `SRGBToLinear`). */
export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** `#rrggbb` -> linear RGB. */
export function hexToLinear(hex: HexColor): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** The Season Profile's values at one Season. Colours are linear RGB. */
export interface SeasonState {
  /** The Season the tracks were sampled at (after shift and wrap). */
  season: number;
  leafColor: RGB;
  /** 0 = bare .. 1 = full. */
  leafCoverage: number;
  /** 0 = none .. 1 = full bloom. */
  blossom: number;
  blossomColor: RGB;
}

/**
 * Evaluates the Season Profile at `season`, shifted by `shift` (a Seed's timing offset,
 * see {@link seasonShift}) and wrapped around the year.
 */
export function evaluateSeason(profile: SeasonProfileDefinition, season: number, shift = 0): SeasonState {
  const s = wrapSeason(season + shift);
  return {
    season: s,
    leafColor: sampleTrack(
      profile.leafColor.map((k) => ({ t: k.t, value: hexToLinear(k.value) })),
      s,
    ),
    leafCoverage: sampleTrack(profile.leafCoverage, s),
    blossom: sampleTrack(profile.blossom, s),
    blossomColor: hexToLinear(profile.blossomColor),
  };
}

/**
 * One part's Season timing: the `aSeason` vertex attribute (vec3: x, y, z) with names.
 * Wood has the tree's shift and zero ranks.
 */
export interface PartSeason {
  /** Timing shift (Season units) from the Seed: tree shift + per-leaf jitter, within ± `variation.season`. */
  shift: number;
  /** 0..1: the leaf shows while leaf coverage > this. */
  coverageRank: number;
  /** 0..1: the leaf is a blossom while blossom > this. */
  blossomRank: number;
}

/** The {@link PartSeason} of vertex `vertex` in `aSeason` attribute data (3 floats per vertex). */
export function partSeasonAt(aSeason: ArrayLike<number>, vertex: number): PartSeason {
  return { shift: aSeason[vertex * 3]!, coverageRank: aSeason[vertex * 3 + 1]!, blossomRank: aSeason[vertex * 3 + 2]! };
}

/**
 * A Seed's Season timing shift for the whole tree: within ± half of `variation.season`.
 * Per-leaf jitter ({@link leafSeasonAttribute}) takes the other half, so a leaf stays within the range.
 */
export function seasonShift(seed: number, variation: Pick<VariationDefinition, 'season'>): number {
  return (seedRandom(seed, 'season') * 2 - 1) * (variation.season / 2);
}

/** The Season timing (`aSeason` attribute) of one leaf; see {@link PartSeason}. */
export function leafSeasonAttribute(
  seed: number,
  variation: Pick<VariationDefinition, 'season'>,
  leafId: string,
): PartSeason {
  const jitter = (seedRandom(seed, `${leafId}#season`) * 2 - 1) * (variation.season / 2);
  return {
    shift: seasonShift(seed, variation) + jitter,
    coverageRank: seedRandom(seed, `${leafId}#coverage`),
    blossomRank: seedRandom(seed, `${leafId}#blossom`),
  };
}

/** `aSeason` for wood vertices: the tree's timing shift, no ranks. */
export function woodSeasonAttribute(seed: number, variation: Pick<VariationDefinition, 'season'>): PartSeason {
  return { shift: seasonShift(seed, variation), coverageRank: 0, blossomRank: 0 };
}

/** One leaf at one Season. */
export interface LeafSeasonState {
  /** False when the leaf has fallen (or not yet grown) and is not a blossom. */
  visible: boolean;
  /** True when the leaf shows as a blossom. */
  blossom: boolean;
  /** Linear RGB before the Seed's per-leaf tint (vertex colour) is multiplied in. */
  color: RGB;
}

/**
 * Evaluates one leaf from its Season timing (`aSeason` attribute, see {@link partSeasonAt}): the
 * exact CPU twin of the leaf shader (see `createSeasonNodes`). Use it to bake a tree at a Season.
 */
export function leafSeason(profile: SeasonProfileDefinition, season: number, part: PartSeason): LeafSeasonState {
  const state = evaluateSeason(profile, season, part.shift);
  const blossom = state.blossom > part.blossomRank;
  return {
    visible: blossom || state.leafCoverage > part.coverageRank,
    blossom,
    color: blossom ? state.blossomColor : state.leafColor,
  };
}
