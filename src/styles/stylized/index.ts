// @casmo/tree.js/styles/stylized: soft toon shading, rounded leaf clumps, blossom in early spring, no image files.
// Pure data plus `apply` (shared with the other Styles), fetched only when imported.
import { coneCurve } from '../../definition/crown-shape';
import { CURRENT_SCHEMA_VERSION, type SeasonProfileDefinition, type TreeDefinition } from '../../definition/types';
import { SEASON_PROFILES } from '../../season/profiles';
import { applyStyle } from '../apply';
import type { TreeStyle } from '../types';

/**
 * Deciduous with blossom: bright, saturated colours for the toon look. Pink blossom covers
 * most of the crown in early spring (Season 0 .. ~0.12, opening in the last days of winter),
 * then the leaves take over: fresh green, summer green, orange and red, bare in winter.
 * Drop the blossom with `extendDefinition(broadleaf, { season: { blossom: [{ t: 0, value: 0 }] } })`.
 */
const blossoming: SeasonProfileDefinition = {
  leafColor: [
    { t: 0, value: '#a5d65a' },
    { t: 0.2, value: '#55a83c' },
    { t: 0.5, value: '#55a83c' },
    { t: 0.58, value: '#f0a530' },
    { t: 0.68, value: '#d9502e' },
    { t: 0.97, value: '#d9502e' },
    { t: 1, value: '#a5d65a' },
  ],
  leafCoverage: SEASON_PROFILES.deciduous.leafCoverage,
  blossom: [
    { t: 0, value: 0.75 },
    { t: 0.08, value: 0.75 },
    { t: 0.15, value: 0 },
    { t: 0.95, value: 0 },
    { t: 1, value: 0.75 },
  ],
  blossomColor: '#ffb3d1',
};

/** Evergreen in toon colours: full all year, a little darker in winter. */
const evergreen: SeasonProfileDefinition = {
  leafColor: [
    { t: 0, value: '#4f9a4a' },
    { t: 0.25, value: '#3c8a45' },
    { t: 0.55, value: '#3c8a45' },
    { t: 0.75, value: '#2e6b40' },
    { t: 0.92, value: '#2e6b40' },
    { t: 1, value: '#4f9a4a' },
  ],
  leafCoverage: [{ t: 0, value: 1 }],
  blossom: [{ t: 0, value: 0 }],
  blossomColor: '#ffb3d1',
};

/**
 * Stylized broadleaf: a curvy trunk with a round crown of big, soft foliage clumps.
 * Flowers pink in early spring, then follows the deciduous year.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Stylized broadleaf',
  trunk: { length: 3.2, radius: 0.24, taper: 0.55, sides: 10, sections: 8, lengthVariation: 0.15, bend: 0.25, flareSections: 3 },
  branches: [
    { count: 6, start: 0.45, end: 0.9, angle: 48, angleVariation: 0.2, spiral: 137.5, length: 0.5, lengthVariation: 0.2, radius: 0.55, taper: 0.5, sides: 8, sections: 5, bend: 0.25, gravity: 0.05 },
    { count: 3, start: 0.4, end: 1, angle: 40, angleVariation: 0.25, spiral: 120, length: 0.5, lengthVariation: 0.25, radius: 0.6, taper: 0.45, sides: 6, sections: 3, bend: 0.2, gravity: 0 },
  ],
  leaves: { count: 2, shape: 'puff', size: 1.1, sizeVariation: 0.3, start: 0.6, angle: 30 },
  materials: {
    shading: 'toon',
    bark: { color: '#8a5a3b', roughness: 1, map: null, normalMap: null },
    leaf: { roughness: 1, map: null, alphaTest: 0.5 },
  },
  season: blossoming,
  wind: { trunk: 0.15, branches: 0.45, leaves: 0.6, frequency: 1 },
  variation: { color: 0.1, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/**
 * Stylized conifer: a straight trunk with soft, upturned whorls that shrink towards the top
 * (a cone Crown Shape), each carrying a few rounded clumps, so the tree reads as a stack of puffs.
 * Evergreen: it only darkens a little in winter.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Stylized conifer',
  trunk: { length: 5, radius: 0.2, taper: 0.2, sides: 8, sections: 6, lengthVariation: 0.15, bend: 0.05, flareSections: 3 },
  branches: [
    { count: 18, start: 0.15, end: 0.97, angle: 85, angleVariation: 0.1, spiral: 137.5, length: 0.5, lengthVariation: 0.1, radius: 0.4, taper: 0.35, sides: 5, sections: 3, bend: 0.1, gravity: 0.05,
      // Crown Shape: a cone, full length at the lowest whorl, a tenth of it at the top.
      lengthProfile: coneCurve(0.15) },
  ],
  leaves: { count: 4, shape: 'puff', size: 0.6, sizeVariation: 0.2, start: 0.1, angle: 20 },
  materials: {
    shading: 'toon',
    bark: { color: '#6e4a35', roughness: 1, map: null, normalMap: null },
    leaf: { roughness: 1, map: null, alphaTest: 0.5 },
  },
  season: evergreen,
  wind: { trunk: 0.1, branches: 0.3, leaves: 0.4, frequency: 0.8 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/** The stylized Style. */
const stylized: TreeStyle = { name: 'stylized', broadleaf, conifer, apply: (source, overrides) => applyStyle('stylized', source, overrides) };
export default stylized;
