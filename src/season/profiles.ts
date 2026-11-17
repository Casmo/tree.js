import type { SeasonProfileDefinition } from '../definition';

/**
 * Ready-made Season Profiles for the Styles (Season: 0 spring, 0.25 summer, 0.5 autumn,
 * 0.75 winter, 1 last day of winter).
 * - `deciduous`: broadleaf; fresh green in spring, deep green in summer, orange and red in
 *   autumn while the leaves fall, bare in winter, buds return at the very end of winter.
 * - `evergreen`: conifer; full all year, only darkens a little in winter.
 */
export const SEASON_PROFILES = {
  deciduous: {
    leafColor: [
      { t: 0, value: '#8bc34a' },
      { t: 0.2, value: '#3e7d2b' },
      { t: 0.5, value: '#3e7d2b' },
      { t: 0.58, value: '#d8892b' },
      { t: 0.68, value: '#a0401f' },
      { t: 0.97, value: '#a0401f' },
      { t: 1, value: '#8bc34a' },
    ],
    leafCoverage: [
      { t: 0, value: 0.4 },
      { t: 0.08, value: 1 },
      { t: 0.6, value: 1 },
      { t: 0.74, value: 0 },
      { t: 0.96, value: 0 },
      { t: 1, value: 0.4 },
    ],
    blossom: [{ t: 0, value: 0 }],
    blossomColor: '#f7c6d9',
  },
  evergreen: {
    leafColor: [
      { t: 0, value: '#3f7a35' },
      { t: 0.25, value: '#2f6a2e' },
      { t: 0.55, value: '#2f6a2e' },
      { t: 0.75, value: '#26502b' },
      { t: 0.92, value: '#26502b' },
      { t: 1, value: '#3f7a35' },
    ],
    leafCoverage: [{ t: 0, value: 1 }],
    blossom: [{ t: 0, value: 0 }],
    blossomColor: '#f7c6d9',
  },
} satisfies Record<string, SeasonProfileDefinition>;
