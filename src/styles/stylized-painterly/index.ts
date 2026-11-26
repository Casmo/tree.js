// @casmo/tree.js/styles/stylized-painterly: Enchanted's shapes in Painterly's paint. Every tree snakes
// with many Twists, its boughs winding out and sagging (Enchanted's trunks, branch levels, Roots, Twist
// recipe and gravity), drawn with Painterly's look: the `painted` shading, smooth painted bark per Bark
// Type, crowns of ragged Leaf Masses made of painted spray cards, and the Species' own natural colours and
// Season (no Leaf Palettes, no Inner Glow). Unlike Painterly it keeps real sizes. Pure data plus `apply`,
// fetched only when imported. Textures: Painterly's (dist/textures/painterly/*.png).
import { coneCurve } from '../../definition/crown-shape';
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from '../../definition/types';
import { SEASON_PROFILES } from '../../season/profiles';
import { applyStyle } from '../apply';
import { BARK_TEXTURES, LEAF_TEXTURES } from '../painterly/textures';
import type { TreeStyle } from '../types';

export { BARK_TEXTURES, LEAF_TEXTURES };

// The shapes below are the Enchanted Definitions' (its showpieces Twist a little more than its recipe,
// which `apply` writes onto a Species: ./recipe.ts).

/**
 * Stylized Painterly broadleaf: the Enchanted broadleaf's ancient, wide tree of several snaking Stems on
 * spreading Roots, with long serpentine boughs low down that wind out and sag, crowned with eight ragged
 * painted Leaf Masses, dark and cool inside, warm yellow-green on the sunlit tops. Deciduous Season Profile.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Stylized Painterly broadleaf',
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
  leaves: { type: 'broad', count: 40, shape: 'mass', size: 0.85, sizeVariation: 0.25, start: 0.35, angle: 50, masses: 8 },
  roots: { count: 7, length: 0.35, lengthVariation: 0.3, radius: 0.45, angle: 12, bend: 0.4, sides: 6, sections: 3 },
  materials: {
    shading: 'stylized-painted',
    bark: { type: 'furrowed', color: '#ffffff', roughness: 1, map: BARK_TEXTURES.furrowed, normalMap: null },
    leaf: { roughness: 1, map: LEAF_TEXTURES.broad, alphaTest: 0.5 },
  },
  season: SEASON_PROFILES.deciduous,
  wind: { trunk: 0.08, branches: 0.35, leaves: 0.5, frequency: 0.8 },
  variation: { color: 0.1, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/**
 * Stylized Painterly conifer: the Enchanted conifer's slim spire that snakes up, with drooping, sinuous
 * branches that shrink towards the top (a cone Crown Shape), its needles grouped into wide, flat painted
 * Leaf Masses stacked in layers (`massLayering`). Evergreen Season Profile.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Stylized Painterly conifer',
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
  leaves: { type: 'needle', count: 50, shape: 'mass', size: 0.8, sizeVariation: 0.2, start: 0.05, angle: 30, masses: 12, massLayering: 1.8 },
  materials: {
    shading: 'stylized-painted',
    bark: { type: 'plated', color: '#ffffff', roughness: 1, map: BARK_TEXTURES.plated, normalMap: null },
    leaf: { roughness: 1, map: LEAF_TEXTURES.needle, alphaTest: 0.5 },
  },
  season: SEASON_PROFILES.evergreen,
  wind: { trunk: 0.06, branches: 0.3, leaves: 0.4, frequency: 0.7 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/** The stylized-painterly Style. */
const stylizedPainterly: TreeStyle = {
  name: 'stylized-painterly',
  broadleaf,
  conifer,
  apply: (source, overrides) => applyStyle('stylized-painterly', source, overrides),
};
export default stylizedPainterly;
