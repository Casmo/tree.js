import { CURRENT_SCHEMA_VERSION, type BranchLevelDefinition, type TreeDefinition } from './types';

/** Defaults for one branching level; fills fields missing from a partial `branches[i]`. */
export const DEFAULT_BRANCH_LEVEL: BranchLevelDefinition = {
  count: 6,
  start: 0.35,
  end: 0.95,
  angle: 45,
  angleVariation: 0.2,
  spiral: 137.5,
  length: 0.5,
  lengthVariation: 0.2,
  radius: 0.6,
  taper: 0.3,
  sides: 6,
  sections: 5,
  bend: 0.1,
  gravity: 0.1,
};

/**
 * The documented defaults: a small broadleaf tree with two branching levels.
 * Anything a Definition leaves out is taken from here.
 */
export const DEFAULT_DEFINITION: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: '',
  form: 'broadleaf',
  trunk: {
    length: 4,
    radius: 0.25,
    taper: 0.4,
    sides: 8,
    sections: 8,
    lengthVariation: 0.15,
    bend: 0.08,
  },
  branches: [
    { ...DEFAULT_BRANCH_LEVEL },
    { ...DEFAULT_BRANCH_LEVEL, count: 4, start: 0.2, angle: 40, length: 0.45, sides: 4, sections: 3 },
  ],
  leaves: {
    count: 8,
    shape: 'card',
    size: 0.25,
    sizeVariation: 0.2,
    start: 0.3,
    angle: 40,
  },
  materials: {
    shading: 'standard',
    bark: { color: '#6b4a2b', roughness: 0.9, map: null, normalMap: null },
    leaf: { roughness: 0.7, map: null, alphaTest: 0.5 },
  },
  season: {
    // Deciduous: fresh green in spring, deep green in summer, autumn colours, bare in winter.
    leafColor: [
      { t: 0, value: '#8bc34a' },
      { t: 0.25, value: '#3e7d2b' },
      { t: 0.5, value: '#3e7d2b' },
      { t: 0.62, value: '#d8892b' },
      { t: 0.72, value: '#a0401f' },
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
  wind: { trunk: 0.2, branches: 0.5, leaves: 0.8, frequency: 1 },
  variation: { color: 0.1, growth: 0.1, season: 0.05 },
  sculpts: [],
};
