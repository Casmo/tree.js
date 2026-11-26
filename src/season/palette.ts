import type { LeafPalette, TreeDefinition } from '../definition';
import { seedRandom } from '../random';

/**
 * Leaf Palettes: the Seed picks one of the Season Profile's `leafPalettes` per tree. The pick has its
 * own random key (`seedRandom`, no stream draws, ADR 0003), so it never shifts any other random number:
 * shapes, Sculpts and Definitions without palettes are untouched.
 */

/** The Leaf Palette the Seed picks for one tree of `definition`; null when it has no Leaf Palettes. */
export function pickLeafPalette(definition: Pick<TreeDefinition, 'season'>, seed: number): LeafPalette | null {
  const palettes = definition.season.leafPalettes;
  if (!palettes?.length) return null;
  return palettes[Math.min(Math.floor(seedRandom(seed, 'leafPalette') * palettes.length), palettes.length - 1)]!;
}

/**
 * The Definition one Seed's tree is drawn with: its Season Profile's `leafColor` is the picked Leaf
 * Palette's, and `leafPalettes` holds only that palette (so `pickLeafPalette` on the result gives it
 * back for any Seed, and a shading built from it can read the accent). The same object when the
 * Definition has no Leaf Palettes. Only colours change: the generator reads none of them.
 */
export function definitionForSeed(definition: TreeDefinition, seed: number): TreeDefinition {
  const palette = pickLeafPalette(definition, seed);
  if (!palette) return definition;
  return { ...definition, season: { ...definition.season, leafColor: palette.leafColor, leafPalettes: [palette] } };
}
