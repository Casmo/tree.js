import type { LeafType } from '../../definition/types';

/**
 * The enchanted Style's texture files, as relative URLs (resolved against the texture base path), made by
 * scripts/generate-textures.mjs: a glowing leaf card per Leaf Type (grey = brightness: bright veins and edge,
 * dark centre; alpha = the cut-out) and one bark texture for every Bark Type (grey grain; alpha = the vein
 * mask the `enchanted` shading's Inner Glow shines through).
 */
export const LEAF_TEXTURES: Readonly<Record<LeafType, string>> = {
  broad: 'enchanted/leaf-broad.png',
  lobed: 'enchanted/leaf-lobed.png',
  palmate: 'enchanted/leaf-palmate.png',
  compound: 'enchanted/leaf-compound.png',
  needle: 'enchanted/leaf-needle.png',
  scale: 'enchanted/leaf-scale.png',
};

/** The bark texture: grey grain, its alpha the vein mask. */
export const BARK_TEXTURE = 'enchanted/bark-veins.png';
