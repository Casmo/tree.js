// @casmo/tree.js/styles/enchanted: the Enchanted Fantasy Style (ADR 0017). Every tree snakes with many
// Twists, with deep indigo bark, sparse glowing leaf cards in teal Leaf Palettes (magenta in autumn) and an
// Inner Glow from its leaves and bark veins that shines with no light on it: made for dark and night scenes.
// Its textures are separate files (dist/textures/enchanted/*.png, made by scripts/generate-textures.mjs),
// referenced by relative URLs like the realistic Style's. Pure data plus `apply`, fetched only when imported.
import { coneCurve } from '../../definition/crown-shape';
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from '../../definition/types';
import { SEASON_PROFILES } from '../../season/profiles';
import { applyStyle } from '../apply';
import { fantasySeason } from '../fantasy';
import type { TreeStyle } from '../types';
import { ENCHANTED } from './recipe';
import { BARK_TEXTURE, LEAF_TEXTURES } from './textures';

export { BARK_TEXTURE, LEAF_TEXTURES };

const materials = (leafMap: string): TreeDefinition['materials'] => ({
  shading: 'enchanted',
  bark: { color: ENCHANTED.barkColor, roughness: 0.85, map: BARK_TEXTURE, normalMap: null },
  leaf: { roughness: 0.8, map: leafMap, alphaTest: 0.4 },
  innerGlow: { ...ENCHANTED.innerGlow! },
});

/**
 * Enchanted broadleaf: an ancient, wide tree of several snaking Stems on spreading Roots, with long
 * serpentine boughs low down that wind out and sag, and sparse glowing cards. Deciduous: teal, turning
 * magenta in autumn.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Enchanted broadleaf',
  trunk: {
    length: 7.5, radius: 0.38, taper: 0.45, sides: 10, sections: 8, lengthVariation: 0.15, bend: 0.12, flareSections: 3,
    stems: 3, spread: 16, flare: 0.6,
    twist: 0.6, twists: 3, twistStyle: 'snake', spin: 'random', twistCurve: 0,
  },
  branches: [
    { count: 7, start: 0.3, end: 0.95, angle: 70, angleVariation: 0.2, spiral: 137.5, length: 0.8, lengthVariation: 0.2, radius: 0.5, taper: 0.55, sides: 5, sections: 3, bend: 0.15, gravity: 0.12,
      twist: 0.9, twists: 4, twistStyle: 'snake', spin: 'random', twistCurve: 0, followTwist: false },
    { count: 4, start: 0.3, end: 1, angle: 45, angleVariation: 0.3, spiral: 140, length: 0.45, lengthVariation: 0.25, radius: 0.55, taper: 0.5, sides: 4, sections: 1, bend: 0.15, gravity: 0.05,
      twist: 0.6, twists: 3, twistStyle: 'snake', spin: 'random', twistCurve: 0, followTwist: false },
  ],
  leaves: { type: 'broad', count: 10, shape: 'card', size: 0.9, sizeVariation: 0.3, start: 0.35, angle: 45 },
  roots: { count: 7, length: 0.35, lengthVariation: 0.3, radius: 0.45, angle: 12, bend: 0.4, sides: 6, sections: 4 },
  materials: materials(LEAF_TEXTURES.broad),
  season: fantasySeason(ENCHANTED, SEASON_PROFILES.deciduous),
  wind: { trunk: 0.08, branches: 0.35, leaves: 0.6, frequency: 0.7 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/**
 * Enchanted conifer: a slim spire that snakes up, with drooping, sinuous branches that shrink towards
 * the top (a cone Crown Shape) and glowing needle cards. Evergreen: teal all year.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Enchanted conifer',
  trunk: {
    length: 9, radius: 0.2, taper: 0.1, sides: 10, sections: 8, lengthVariation: 0.1, bend: 0.04, flareSections: 3, gravity: -0.2,
    twist: 0.35, twists: 3, twistStyle: 'snake', spin: 'random', twistCurve: 0,
  },
  branches: [
    { count: 36, start: 0.12, end: 0.97, angle: 100, angleVariation: 0.1, spiral: 137.5, length: 0.42, lengthVariation: 0.15, radius: 0.3, taper: 0.3, sides: 5, sections: 3, bend: 0.1, gravity: 0.35,
      twist: 0.8, twists: 4, twistStyle: 'snake', spin: 'random', twistCurve: 0, followTwist: false,
      // Crown Shape: a cone, full length at the lowest whorl, a tenth of it at the top.
      lengthProfile: coneCurve(0.12) },
  ],
  leaves: { type: 'needle', count: 16, shape: 'card', size: 0.8, sizeVariation: 0.2, start: 0.1, angle: 40 },
  materials: materials(LEAF_TEXTURES.needle),
  season: fantasySeason(ENCHANTED, SEASON_PROFILES.evergreen),
  wind: { trunk: 0.06, branches: 0.3, leaves: 0.4, frequency: 0.7 },
  variation: { color: 0.06, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/** The enchanted Style. */
const enchanted: TreeStyle = { name: 'enchanted', broadleaf, conifer, apply: (source, overrides) => applyStyle('enchanted', source, overrides) };
export default enchanted;
