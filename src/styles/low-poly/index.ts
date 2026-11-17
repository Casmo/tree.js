// @casmo/tree.js/styles/low-poly: faceted geometry, flat vertex colours, no image files.
// Pure data (no library code), so it stays a tiny chunk that is only fetched when imported.
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from '../../definition/types';
import type { TreeStyle } from '../types';

/**
 * Low-poly broadleaf: a short, stout trunk and a few branches, crowned by faceted foliage
 * clumps. Deciduous: fresh green in spring, autumn oranges, bare in winter.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Low-poly broadleaf',
  form: 'broadleaf',
  trunk: { length: 3, radius: 0.22, taper: 0.5, sides: 5, sections: 3, lengthVariation: 0.15, bend: 0.12 },
  branches: [
    { count: 5, start: 0.5, end: 0.92, angle: 42, angleVariation: 0.2, spiral: 137.5, length: 0.5, lengthVariation: 0.2, radius: 0.55, taper: 0.45, sides: 4, sections: 2, bend: 0.12, gravity: 0.15 },
    { count: 3, start: 0.35, end: 1, angle: 38, angleVariation: 0.25, spiral: 120, length: 0.55, lengthVariation: 0.25, radius: 0.6, taper: 0.4, sides: 3, sections: 1, bend: 0.1, gravity: 0.1 },
  ],
  leaves: { count: 2, shape: 'clump', size: 1, sizeVariation: 0.25, start: 0.55, angle: 25 },
  materials: {
    shading: 'flat',
    bark: { color: '#7a5233', roughness: 1, map: null, normalMap: null },
    leaf: { roughness: 1, map: null, alphaTest: 0.5 },
  },
  season: {
    leafColor: [
      { t: 0, value: '#a5d65a' },
      { t: 0.25, value: '#5fa83a' },
      { t: 0.5, value: '#5fa83a' },
      { t: 0.62, value: '#f2a531' },
      { t: 0.72, value: '#d4552b' },
    ],
    leafCoverage: [
      { t: 0, value: 0.3 },
      { t: 0.1, value: 1 },
      { t: 0.62, value: 1 },
      { t: 0.75, value: 0 },
      { t: 0.97, value: 0 },
      { t: 1, value: 0.3 },
    ],
    blossom: [{ t: 0, value: 0 }],
    blossomColor: '#f7c6d9',
  },
  wind: { trunk: 0.15, branches: 0.4, leaves: 0.5, frequency: 1 },
  variation: { color: 0.12, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/**
 * Low-poly conifer: a straight trunk with drooping whorls that shrink towards the top
 * (the conifer Form), covered in faceted needle tufts. Evergreen: it only darkens a little in winter.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Low-poly conifer',
  form: 'conifer',
  trunk: { length: 5, radius: 0.2, taper: 0.15, sides: 5, sections: 4, lengthVariation: 0.15, bend: 0.03 },
  branches: [
    { count: 24, start: 0.18, end: 0.97, angle: 95, angleVariation: 0.08, spiral: 137.5, length: 0.42, lengthVariation: 0.15, radius: 0.4, taper: 0.3, sides: 3, sections: 2, bend: 0.05, gravity: -0.08 },
  ],
  leaves: { count: 7, shape: 'needle', size: 0.65, sizeVariation: 0.2, start: 0, angle: 35 },
  materials: {
    shading: 'flat',
    bark: { color: '#5c4030', roughness: 1, map: null, normalMap: null },
    leaf: { roughness: 1, map: null, alphaTest: 0.5 },
  },
  season: {
    leafColor: [
      { t: 0, value: '#3f8a4a' },
      { t: 0.5, value: '#2f7340' },
      { t: 0.8, value: '#285e3c' },
      { t: 1, value: '#3a8046' },
    ],
    leafCoverage: [{ t: 0, value: 1 }],
    blossom: [{ t: 0, value: 0 }],
    blossomColor: '#f7c6d9',
  },
  wind: { trunk: 0.1, branches: 0.3, leaves: 0.3, frequency: 0.8 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/** The low-poly Style. */
const lowPoly: TreeStyle = { name: 'low-poly', broadleaf, conifer };
export default lowPoly;
