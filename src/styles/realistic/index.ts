// @casmo/tree.js/styles/realistic: smooth PBR shading, textured bark and alpha-cut leaf cards.
// Pure data (no library code beyond shared constants), so it stays a tiny chunk fetched only when imported.
// The textures are separate files (dist/textures/realistic/*.png, made by scripts/generate-textures.mjs),
// referenced by relative URLs that resolve against the texture base path (`setTextureOptions`,
// or `createTree(definition, { textures: { basePath } })`), so an app can host them on its own CDN.
import { CURRENT_SCHEMA_VERSION, type TreeDefinition } from '../../definition/types';
import { SEASON_PROFILES } from '../../season/profiles';
import type { TreeStyle } from '../types';

/** The realistic Style's texture files, as relative URLs (resolved against the texture base path). */
export const TEXTURES = {
  bark: 'realistic/bark.png',
  barkNormal: 'realistic/bark-normal.png',
  leaf: 'realistic/leaf.png',
  needles: 'realistic/needles.png',
} as const;

/**
 * Realistic broadleaf: a tall, slightly leaning trunk with three branching levels and many
 * leaf-spray cards. Deciduous Season Profile: fresh green in spring, autumn colours, bare in winter.
 */
export const broadleaf: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Realistic broadleaf',
  form: 'broadleaf',
  trunk: { length: 5, radius: 0.28, taper: 0.55, sides: 12, sections: 10, lengthVariation: 0.15, bend: 0.1 },
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
 * (the conifer Form), covered in needle-spray cards. Evergreen Season Profile.
 */
export const conifer: TreeDefinition = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Realistic conifer',
  form: 'conifer',
  trunk: { length: 7, radius: 0.22, taper: 0.9, sides: 10, sections: 10, lengthVariation: 0.12, bend: 0.03 },
  branches: [
    { count: 30, start: 0.15, end: 0.97, angle: 90, angleVariation: 0.1, spiral: 137.5, length: 0.4, lengthVariation: 0.15, radius: 0.35, taper: 0.4, sides: 5, sections: 4, bend: 0.08, gravity: 0.15 },
    { count: 4, start: 0.2, end: 1, angle: 50, angleVariation: 0.2, spiral: 180, length: 0.4, lengthVariation: 0.2, radius: 0.5, taper: 0.5, sides: 3, sections: 2, bend: 0.05, gravity: 0.1 },
  ],
  leaves: { count: 5, shape: 'card', size: 0.65, sizeVariation: 0.2, start: 0, angle: 30 },
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
const realistic: TreeStyle = { name: 'realistic', broadleaf, conifer };
export default realistic;
