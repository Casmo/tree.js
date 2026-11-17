import { CURRENT_SCHEMA_VERSION, type BranchLevelDefinition, type TreeDefinition } from './types';

/** Defaults for any field left out of a branch level. */
export const DEFAULT_BRANCH_LEVEL: BranchLevelDefinition = {
  count: 5,
  countVariation: 0.2,
  start: 0.3,
  length: 0.5,
  lengthVariation: 0.2,
  radius: 0.6,
  taper: 0.4,
  angle: 50,
  angleVariation: 15,
  bend: 0.15,
  sides: 5,
  sections: 4,
};

export const DEFAULT_DEFINITION: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  trunk: {
    length: 4,
    radius: 0.25,
    taper: 0.4,
    sides: 8,
    sections: 8,
    lengthVariation: 0.15,
    bend: 0.08,
  },
  bark: {
    color: '#6b4a2b',
  },
  branches: [
    { ...DEFAULT_BRANCH_LEVEL, count: 7, start: 0.35, length: 0.45, radius: 0.55, angle: 55, sides: 6, sections: 5 },
    { ...DEFAULT_BRANCH_LEVEL, count: 4, start: 0.2, length: 0.5, angle: 45, sides: 5, sections: 3 },
    { ...DEFAULT_BRANCH_LEVEL, count: 3, start: 0.3, length: 0.45, angle: 40, sides: 3, sections: 2 },
  ],
  leaves: {
    count: 5,
    start: 0.2,
    size: 0.35,
    sizeVariation: 0.25,
    color: '#4f8a32',
    colorVariation: 0.15,
  },
};
