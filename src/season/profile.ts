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
 * A Seed's Season timing shift for the whole tree: within ± half of `variation.season`.
 * Per-leaf jitter ({@link leafSeasonAttribute}) takes the other half, so a leaf stays within the range.
 */
export function seasonShift(seed: number, variation: Pick<VariationDefinition, 'season'>): number {
  return (seedRandom(seed, 'season') * 2 - 1) * (variation.season / 2);
}

/**
 * The `aSeason` vertex attribute (vec3) of one leaf:
 * x = timing shift (tree shift + leaf jitter, within ± `variation.season`),
 * y = coverage rank (0..1; the leaf shows while leaf coverage > y),
 * z = blossom rank (0..1; the leaf is a blossom while blossom > z).
 */
export function leafSeasonAttribute(
  seed: number,
  variation: Pick<VariationDefinition, 'season'>,
  leafId: string,
): [shift: number, coverageRank: number, blossomRank: number] {
  const jitter = (seedRandom(seed, `${leafId}#season`) * 2 - 1) * (variation.season / 2);
  return [
    seasonShift(seed, variation) + jitter,
    seedRandom(seed, `${leafId}#coverage`),
    seedRandom(seed, `${leafId}#blossom`),
  ];
}

/** `aSeason` for wood vertices: the tree's timing shift, no ranks. */
export function woodSeasonAttribute(seed: number, variation: Pick<VariationDefinition, 'season'>): [number, number, number] {
  return [seasonShift(seed, variation), 0, 0];
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
 * Evaluates one leaf from its `aSeason` attribute: the exact CPU twin of the leaf shader
 * (see `createSeasonNodes`). Use it to bake a tree at a Season.
 */
export function leafSeason(
  profile: SeasonProfileDefinition,
  season: number,
  aSeason: readonly [number, number, number] | ArrayLike<number>,
): LeafSeasonState {
  const state = evaluateSeason(profile, season, aSeason[0]!);
  const blossom = state.blossom > aSeason[2]!;
  return {
    visible: blossom || state.leafCoverage > aSeason[1]!,
    blossom,
    color: blossom ? state.blossomColor : state.leafColor,
  };
}
