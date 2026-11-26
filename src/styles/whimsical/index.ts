// @casmo/tree.js/styles/whimsical: the Whimsical Fantasy Style (ADR 0017). Every tree corkscrews as one,
// in candy colours (a Leaf Palette per Seed), with big pom-pom puffs and the `whimsical` shading: crisp
// toon bands, a coloured rim light and a candy stripe winding round its pale cream bark. No image files.
// Pure data plus `apply` (shared with the other Styles), fetched only when imported.
import { coneCurve } from '../../definition/crown-shape';
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from '../../definition/types';
import { SEASON_PROFILES } from '../../season/profiles';
import { applyStyle } from '../apply';
import { fantasySeason } from '../fantasy';
import type { TreeStyle } from '../types';
import { WHIMSICAL } from './recipe';

const materials: TreeDefinition['materials'] = {
  shading: 'whimsical',
  bark: { color: WHIMSICAL.barkColor, roughness: 1, map: null, normalMap: null },
  leaf: { roughness: 1, map: null, alphaTest: 0.5 },
};

/**
 * Whimsical broadleaf: a tall, thin, Truffula-like trunk that corkscrews and leans round with its Twist
 * Curve, a few long branches that follow its swirl, and a big pom-pom at each tip. Deciduous,
 * in the five candy Leaf Palettes.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Whimsical broadleaf',
  trunk: {
    length: 6.5, radius: 0.13, taper: 0.55, sides: 10, sections: 8, lengthVariation: 0.15, bend: 0.05, flareSections: 3,
    twist: 0.3, twists: 2, twistStyle: 'corkscrew', spin: 'random', twistCurve: 0.35,
  },
  branches: [
    { count: 5, start: 0.55, end: 0.97, angle: 38, angleVariation: 0.2, spiral: 137.5, length: 0.45, lengthVariation: 0.25, radius: 0.5, taper: 0.5, sides: 6, sections: 3, bend: 0.05, gravity: 0.1,
      twist: 0.6, twists: 2, twistStyle: 'corkscrew', spin: 'random', twistCurve: 0.3, followTwist: true },
  ],
  leaves: { type: 'broad', count: 1, shape: 'puff', size: 1.4, sizeVariation: 0.25, start: 0.9, angle: 20 },
  materials,
  season: fantasySeason(WHIMSICAL, SEASON_PROFILES.deciduous),
  wind: { trunk: 0.2, branches: 0.5, leaves: 0.5, frequency: 0.9 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/**
 * Whimsical conifer: a helter-skelter, a cone of upturned whorls spiralling up a trunk that corkscrews
 * eight times, each whorl following its swirl, with stacks of small pom-poms. Evergreen, in candy colours.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Whimsical conifer',
  trunk: {
    length: 6, radius: 0.2, taper: 0.2, sides: 10, sections: 8, lengthVariation: 0.1, bend: 0.03, flareSections: 3,
    twist: 0.3, twists: 8, twistStyle: 'corkscrew', spin: 'random', twistCurve: 0,
  },
  branches: [
    { count: 26, start: 0.15, end: 0.97, angle: 78, angleVariation: 0.08, spiral: 137.5, length: 0.5, lengthVariation: 0.1, radius: 0.4, taper: 0.35, sides: 6, sections: 3, bend: 0.05, gravity: 0.1,
      twist: 0.6, twists: 1, twistStyle: 'corkscrew', spin: 'random', twistCurve: 0.25, followTwist: true,
      // Crown Shape: a cone, full length at the lowest whorl, a tenth of it at the top.
      lengthProfile: coneCurve(0.15) },
  ],
  leaves: { type: 'needle', count: 3, shape: 'puff', size: 0.5, sizeVariation: 0.2, start: 0.3, angle: 20 },
  materials,
  season: fantasySeason(WHIMSICAL, SEASON_PROFILES.evergreen),
  wind: { trunk: 0.1, branches: 0.3, leaves: 0.4, frequency: 0.8 },
  variation: { color: 0.06, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/** The whimsical Style. */
const whimsical: TreeStyle = { name: 'whimsical', broadleaf, conifer, apply: (source, overrides) => applyStyle('whimsical', source, overrides) };
export default whimsical;
