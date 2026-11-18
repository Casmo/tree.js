// @casmo/tree.js/styles/realistic: smooth PBR shading, textured bark and alpha-cut leaf cards.
// Pure data plus `apply` (shared with the other Styles), fetched only when imported.
// The textures are separate files (dist/textures/realistic/*.png, made by scripts/generate-textures.mjs),
// referenced by relative URLs that resolve against the texture base path (`setTextureOptions`,
// or `createTree(definition, { textures: { basePath } })`), so an app can host them on its own CDN.
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from '../../definition/types';
import { SEASON_PROFILES } from '../../season/profiles';
import { applyStyle } from '../apply';
import type { TreeStyle } from '../types';
import { BARK_TEXTURES, LEAF_TEXTURES, TEXTURES } from './textures';

export { BARK_TEXTURES, LEAF_TEXTURES, TEXTURES };

/**
 * Realistic broadleaf: a tall, slightly leaning trunk with three branching levels and many
 * leaf-spray cards. Deciduous Season Profile: fresh green in spring, autumn colours, bare in winter.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Realistic broadleaf',
  trunk: { length: 5, radius: 0.28, taper: 0.35, sides: 12, sections: 10, lengthVariation: 0.15, bend: 0.1 },
  branches: [
    { count: 8, start: 0.4, end: 0.95, angle: 48, angleVariation: 0.2, spiral: 137.5, length: 0.5, lengthVariation: 0.2, radius: 0.5, taper: 0.5, sides: 8, sections: 6, bend: 0.15, gravity: 0.05 },
    { count: 5, start: 0.25, end: 1, angle: 40, angleVariation: 0.25, spiral: 120, length: 0.5, lengthVariation: 0.25, radius: 0.55, taper: 0.5, sides: 5, sections: 4, bend: 0.15, gravity: 0.1 },
    { count: 3, start: 0.3, end: 1, angle: 35, angleVariation: 0.3, spiral: 140, length: 0.5, lengthVariation: 0.3, radius: 0.6, taper: 0.5, sides: 3, sections: 2, bend: 0.1, gravity: 0.15 },
  ],
  leaves: { count: 6, shape: 'card', size: 0.7, sizeVariation: 0.25, start: 0.2, angle: 45 },
  materials: {
    shading: 'standard',
    bark: { color: '#c9bba8', roughness: 0.95, map: TEXTURES.bark, normalMap: TEXTURES.barkNormal },
    leaf: { roughness: 0.65, map: TEXTURES.leaf, alphaTest: 0.4 },
  },
  season: SEASON_PROFILES.deciduous,
  wind: { trunk: 0.15, branches: 0.45, leaves: 0.8, frequency: 1 },
  variation: { color: 0.1, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/**
 * Realistic conifer: a straight trunk with dense, drooping whorls that shrink towards the top
 * (a cone Crown Shape), covered in needle-spray cards. Evergreen Season Profile.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Realistic conifer',
  trunk: { length: 7, radius: 0.24, taper: 0.08, sides: 10, sections: 10, lengthVariation: 0.12, bend: 0.03 },
  branches: [
    { count: 34, start: 0.12, end: 0.97, angle: 88, angleVariation: 0.1, spiral: 137.5, length: 0.38, lengthVariation: 0.15, radius: 0.22, taper: 0.25, sides: 5, sections: 4, bend: 0.08, gravity: 0.12,
      // Crown Shape: a cone, full length at the lowest whorl, a tenth of it at the top.
      lengthProfile: [{ t: 0.12, value: 1 }, { t: 0.912, value: 0.1 }, { t: 1, value: 0.1 }] },
    { count: 6, start: 0.15, end: 1, angle: 55, angleVariation: 0.2, spiral: 180, length: 0.45, lengthVariation: 0.2, radius: 0.5, taper: 0.4, sides: 3, sections: 2, bend: 0.05, gravity: 0.1 },
  ],
  leaves: { count: 8, shape: 'card', size: 0.8, sizeVariation: 0.2, start: 0, angle: 35 },
  materials: {
    shading: 'standard',
    bark: { color: '#b0a090', roughness: 0.95, map: TEXTURES.bark, normalMap: TEXTURES.barkNormal },
    leaf: { roughness: 0.7, map: TEXTURES.needles, alphaTest: 0.4 },
  },
  season: SEASON_PROFILES.evergreen,
  wind: { trunk: 0.08, branches: 0.3, leaves: 0.4, frequency: 0.8 },
  variation: { color: 0.08, growth: 0.1, season: 0.05 },
  sculpts: [],
};

/** The realistic Style. */
const realistic: TreeStyle = { name: 'realistic', broadleaf, conifer, apply: (source, overrides) => applyStyle('realistic', source, overrides) };
export default realistic;
