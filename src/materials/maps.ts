import type { MeshStandardNodeMaterial, Texture } from 'three/webgpu';
import { normalMap, texture, uv, vec2 } from 'three/tsl';
import type { BarkMaterialDefinition, LeafMaterialDefinition } from '../definition';
import { loadTexture, resolveTextureUrl, type TextureOptions } from '../textures';

// TSL node types are loosely typed in @types/three; keep our own alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/**
 * How often the bark texture repeats around (u) and along (v) a branch. Bark UVs run 0..1
 * around and 0..1 along each branch, so this keeps the bark from stretching along long parts.
 */
export const BARK_REPEAT: readonly [number, number] = [2, 6];

/**
 * Textured bark: `color × map` (the glTF base colour convention) and a tangent-space normal map,
 * both tiled by `BARK_REPEAT`. Returns the colour node to use, or `base` when there is no map.
 * `.map` / `.normalMap` are also set, for exporters and so `tree.ready` can wait for them.
 */
export function applyBarkMaps(
  material: MeshStandardNodeMaterial,
  bark: BarkMaterialDefinition,
  base: Node,
  textures?: TextureOptions,
): Node {
  const tiled = uv().mul(vec2(...BARK_REPEAT));
  if (bark.normalMap) {
    material.normalMap = load(bark.normalMap, 'data', textures);
    material.normalNode = normalMap(texture(material.normalMap, tiled));
  }
  if (!bark.map) return base;
  material.map = load(bark.map, 'color', textures);
  return base.mul(texture(material.map, tiled).rgb);
}

/**
 * Alpha-cut leaf cards: `colorNode` = the card texture (rgba, card UVs), cut at `alphaTest`.
 * The Season colour is multiplied in later (`applySeasonToLeafMaterial`). `.map` is set too, so
 * the shadow pass cuts the same shape out of the leaf shadows.
 */
export function applyLeafMap(material: MeshStandardNodeMaterial, leaf: LeafMaterialDefinition, textures?: TextureOptions): void {
  if (!leaf.map) return;
  material.map = load(leaf.map, 'color', textures);
  material.colorNode = texture(material.map);
  material.alphaTest = leaf.alphaTest;
}

const load = (url: string, kind: 'color' | 'data', textures?: TextureOptions): Texture =>
  loadTexture(resolveTextureUrl(url, textures), kind);
