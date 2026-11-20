import type { BarkType, LeafType } from '../../definition/types';

/**
 * The painterly Style's texture files, as relative URLs (resolved against the texture base path), made by
 * scripts/generate-textures.mjs: a painted leaf-spray card per Leaf Type (grey = paint value, alpha = the
 * cut-out, stem at the bottom middle) and painted bark per Bark Type (real colours, no normal maps).
 */
export const LEAF_TEXTURES: Readonly<Record<LeafType, string>> = {
  broad: 'painterly/spray-broad.png',
  lobed: 'painterly/spray-lobed.png',
  palmate: 'painterly/spray-palmate.png',
  compound: 'painterly/spray-compound.png',
  needle: 'painterly/spray-needle.png',
  scale: 'painterly/spray-scale.png',
};

/** The painted bark texture for each Bark Type. */
export const BARK_TEXTURES: Readonly<Record<BarkType, string>> = {
  furrowed: 'painterly/bark-furrowed.png',
  smooth: 'painterly/bark-smooth.png',
  papery: 'painterly/bark-papery.png',
  fibrous: 'painterly/bark-fibrous.png',
  plated: 'painterly/bark-plated.png',
};
