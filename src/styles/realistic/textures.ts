import type { BarkType, LeafType } from '../../definition/types';

/**
 * The realistic Style's texture files, as relative URLs (resolved against the texture base path).
 * All made by scripts/generate-textures.mjs. `bark`/`barkNormal` are the furrowed pair, `leaf` the
 * broad card and `needles` the needle card (the generic broadleaf / conifer use these).
 */
export const TEXTURES = {
  bark: 'realistic/bark.png',
  barkNormal: 'realistic/bark-normal.png',
  leaf: 'realistic/leaf.png',
  needles: 'realistic/needles.png',
} as const;

/** The alpha-cut leaf card texture for each Leaf Type. */
export const LEAF_TEXTURES: Readonly<Record<LeafType, string>> = {
  broad: TEXTURES.leaf,
  lobed: 'realistic/leaf-lobed.png',
  palmate: 'realistic/leaf-palmate.png',
  compound: 'realistic/leaf-compound.png',
  needle: TEXTURES.needles,
  scale: 'realistic/scale.png',
};

/** The colour + normal map pair for each Bark Type. */
export const BARK_TEXTURES: Readonly<Record<BarkType, { map: string; normalMap: string }>> = {
  furrowed: { map: TEXTURES.bark, normalMap: TEXTURES.barkNormal },
  smooth: { map: 'realistic/bark-smooth.png', normalMap: 'realistic/bark-smooth-normal.png' },
  papery: { map: 'realistic/bark-papery.png', normalMap: 'realistic/bark-papery-normal.png' },
  fibrous: { map: 'realistic/bark-fibrous.png', normalMap: 'realistic/bark-fibrous-normal.png' },
  plated: { map: 'realistic/bark-plated.png', normalMap: 'realistic/bark-plated-normal.png' },
};
