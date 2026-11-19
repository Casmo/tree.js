import { describe, expect, it } from 'vitest';
import { decodeSeasonTexel, encodeSeasonTexel } from '../src/forest/impostor-season';
import { leafSeason, leafSeasonAttribute, SEASON_PROFILES } from '../src/index';

/** What an 8-bit atlas keeps of a texel. */
const stored = (texel: readonly number[]) => texel.map((c) => Math.round(c * 255) / 255) as [number, number, number, number];

describe('Impostor Season atlas texels', () => {
  it('hold a leaf: timing shift, coverage rank, blossom rank and the leaf flag, each within 0..1', () => {
    // variation.season is at most 1: a leaf's shift is within ±1.
    for (const part of [
      { shift: -1, coverageRank: 0, blossomRank: 1 },
      { shift: 1, coverageRank: 1, blossomRank: 0 },
      { shift: 0.13, coverageRank: 0.42, blossomRank: 0.77 },
    ]) {
      const texel = encodeSeasonTexel(part);
      for (const c of texel) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(texel[3]).toBe(1);
      const back = decodeSeasonTexel(stored(texel));
      expect(back.shift).toBeCloseTo(part.shift, 2);
      expect(back.coverageRank).toBeCloseTo(part.coverageRank, 2);
      expect(back.blossomRank).toBeCloseTo(part.blossomRank, 2);
    }
  });

  it('decode premultiplied texels (blended with the empty background) to the leaves they cover', () => {
    const part = { shift: -0.2, coverageRank: 0.6, blossomRank: 0.3 };
    const quarter = encodeSeasonTexel(part).map((c) => c * 0.25) as [number, number, number, number];
    const back = decodeSeasonTexel(quarter);
    expect(back.shift).toBeCloseTo(part.shift, 6);
    expect(back.coverageRank).toBeCloseTo(part.coverageRank, 6);
    expect(back.blossomRank).toBeCloseTo(part.blossomRank, 6);
  });

  it('give an Impostor leaf the state of the leaf it pictures (8-bit atlas)', () => {
    const profile = SEASON_PROFILES.deciduous;
    let agree = 0;
    let total = 0;
    for (let leaf = 0; leaf < 200; leaf++) {
      const part = leafSeasonAttribute(7, { season: 0.2 }, `leaf ${leaf}`);
      const back = decodeSeasonTexel(stored(encodeSeasonTexel(part)));
      for (const season of [0.05, 0.37, 0.62, 0.68, 0.85]) {
        total++;
        if (leafSeason(profile, season, back).visible === leafSeason(profile, season, part).visible) agree++;
      }
    }
    // Only leaves within the 8-bit step of their drop time can differ.
    expect(agree / total).toBeGreaterThan(0.98);
  });

  it('are empty for wood', () => {
    expect(encodeSeasonTexel(null)).toEqual([0, 0, 0, 0]);
  });
});
