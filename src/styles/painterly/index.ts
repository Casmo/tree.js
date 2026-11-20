// @casmo/tree.js/styles/painterly: painted, small trees for top-down games (ADR 0013, ADR 0014).
// Soft warm wrap lighting with a painted crown gradient (`painted` shading), crowns of a few Leaf Masses
// made of alpha-cut painted spray cards, smooth painted bark. Pure data plus `apply` (shared with the
// other Styles), fetched only when imported. Textures: dist/textures/painterly/*.png (see ../realistic).
import { coneCurve } from '../../definition/crown-shape';
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from '../../definition/types';
import { SEASON_PROFILES } from '../../season/profiles';
import { applyStyle } from '../apply';
import type { TreeStyle } from '../types';
import { BARK_TEXTURES, LEAF_TEXTURES } from './textures';

export { BARK_TEXTURES, LEAF_TEXTURES };

/**
 * Painterly broadleaf, 3 m at full Growth: a short, tapered trunk that splits into a few low boughs, and a
 * round crown of eight ragged Leaf Masses, dark and cool inside, warm yellow-green on the sunlit tops.
 * Deciduous Season Profile.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Painterly broadleaf',
  styleScale: 1,
  trunk: { length: 1.8, radius: 0.13, taper: 0.45, sides: 10, sections: 6, lengthVariation: 0.08, bend: 0.2, flare: 0.6, flareSections: 3 },
  branches: [
    { count: 7, start: 0.4, end: 0.95, angle: 50, angleVariation: 0.15, spiral: 137.5, length: 0.7, lengthVariation: 0.15, radius: 0.6, taper: 0.45, sides: 6, sections: 3, bend: 0.2, gravity: 0.03,
      // Crown Shape: a round crown, shorter and steeper boughs towards the top.
      lengthProfile: [{ t: 0.4, value: 1 }, { t: 1, value: 0.55 }], angleProfile: [{ t: 0.4, value: 1.1 }, { t: 1, value: 0.6 }] },
    { count: 3, start: 0.3, end: 1, angle: 45, angleVariation: 0.3, spiral: 137.5, length: 0.55, lengthVariation: 0.15, radius: 0.6, taper: 0.45, sides: 4, sections: 1, bend: 0.25, gravity: 0.1 },
  ],
  leaves: { type: 'broad', count: 60, shape: 'mass', size: 0.5, sizeVariation: 0.25, start: 0.1, angle: 50, masses: 8 },
  materials: {
    shading: 'painted',
    bark: { type: 'furrowed', color: '#ffffff', roughness: 1, map: BARK_TEXTURES.furrowed, normalMap: null },
    leaf: { roughness: 1, map: LEAF_TEXTURES.broad, alphaTest: 0.5 },
  },
  season: SEASON_PROFILES.deciduous,
  wind: { trunk: 0.12, branches: 0.4, leaves: 0.5, frequency: 1 },
  variation: { color: 0.1, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/**
 * Painterly conifer, 3.5 m at full Growth: a straight trunk with many level whorls that shrink towards the
 * top (a cone Crown Shape), its needles grouped into a dozen wide, flat Leaf Masses stacked in layers
 * (`massLayering`), each a ragged clump of painted needle sprays (ADR 0014: no Tier geometry).
 * Evergreen Season Profile.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Painterly conifer',
  styleScale: 1,
  trunk: { length: 3.2, radius: 0.1, taper: 0.15, sides: 8, sections: 6, lengthVariation: 0.08, bend: 0.05, flare: 0.4, flareSections: 3 },
  branches: [
    { count: 24, start: 0.18, end: 0.98, angle: 90, angleVariation: 0.1, spiral: 137.5, length: 0.38, lengthVariation: 0.15, radius: 0.25, taper: 0.35, sides: 4, sections: 2, bend: 0.1, gravity: 0.08,
      // Crown Shape: a cone from the lowest whorl.
      lengthProfile: coneCurve(0.18) },
  ],
  leaves: { type: 'needle', count: 50, shape: 'mass', size: 0.48, sizeVariation: 0.2, start: 0, angle: 30, masses: 12, massLayering: 1.8 },
  materials: {
    shading: 'painted',
    bark: { type: 'plated', color: '#ffffff', roughness: 1, map: BARK_TEXTURES.plated, normalMap: null },
    leaf: { roughness: 1, map: LEAF_TEXTURES.needle, alphaTest: 0.5 },
  },
  season: SEASON_PROFILES.evergreen,
  wind: { trunk: 0.08, branches: 0.3, leaves: 0.4, frequency: 0.8 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/** The painterly Style. */
const painterly: TreeStyle = { name: 'painterly', broadleaf, conifer, apply: (source, overrides) => applyStyle('painterly', source, overrides) };
export default painterly;
