import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from './types';

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
};
