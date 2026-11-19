// The Impostor's Season atlas texel (ADR 0010), as pure maths: what the bake writes for a leaf and
// how the Impostor shader reads it back (the TSL twins are in impostor.ts and impostor-material.ts).
// No three.js at runtime.
import type { PartSeason } from '../season/profile';

/** A texel: r = timing shift (−1..1 as 0..1), g = coverage rank, b = blossom rank, a = 1 on leaves. */
export type SeasonTexel = readonly [number, number, number, number];

/** The leaf timing shift is within ±`variation.season` (at most 1); the atlas keeps it as `shift · SCALE + 0.5`. */
export const SEASON_SHIFT_SCALE = 0.5;

/** The texel the bake writes for a leaf (`aSeason`), or for wood (`null`: empty). */
export function encodeSeasonTexel(part: PartSeason | null): SeasonTexel {
  if (!part) return [0, 0, 0, 0];
  return [part.shift * SEASON_SHIFT_SCALE + 0.5, part.coverageRank, part.blossomRank, 1];
}

/**
 * The leaf Season timing a (filtered, premultiplied) texel pictures: divided by its leaf share `a`
 * (mipmaps and frame blends mix texels with the empty background).
 */
export function decodeSeasonTexel(texel: SeasonTexel): PartSeason {
  const a = Math.max(texel[3], 1e-4);
  return { shift: (texel[0] / a - 0.5) / SEASON_SHIFT_SCALE, coverageRank: texel[1] / a, blossomRank: texel[2] / a };
}
