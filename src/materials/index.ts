import { DoubleSide, type MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, uv, float } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import type { TextureOptions } from '../textures';
import { applyBarkMaps, applyLeafMap } from './maps';
import { createShadedMaterial, isFlatShading } from './shading';

export { createShadedMaterial } from './shading';

/**
 * Bark material: a TSL node material (ADR 0002). Growth/Season/Wind uniforms and
 * per-Style variants hook in here in later tickets (#5-#10). `materials.bark.map` / `.normalMap`
 * load through `textures` (base path / URL overrides, see `TextureOptions`).
 */
export function createBarkMaterial(definition: TreeDefinition, textures?: TextureOptions): MeshStandardNodeMaterial {
  const material = createShadedMaterial(definition.materials.shading);
  material.name = 'tree.js bark';
  material.userData.treePart = 'bark'; // Tree Effects (`/effects`) find tree pixels by it
  const base = color(definition.materials.bark.color);
  // Slightly darker towards the base for a little depth, purely in TSL (flat colour for flat shading).
  const shaded = isFlatShading(definition.materials.shading)
    ? base
    : mix(base.mul(0.75), base, uv().y.clamp(0, 1).pow(float(0.5)));
  material.colorNode = applyBarkMaps(material, definition.materials.bark, shaded, textures);
  material.roughness = definition.materials.bark.roughness;
  material.metalness = 0;
  return material;
}

/**
 * Leaf material: a TSL node material lit from both sides. `.color` is the Season Profile's
 * leaf colour at Season 0 (what exporters see); `Tree` adds the Season nodes
 * (`applySeasonToLeafMaterial`), whose colour is multiplied by the per-leaf vertex colours (the Seed's tint)
 * and by the leaf card texture (`materials.leaf.map`, alpha cut at `alphaTest`), if any.
 */
export function createLeafMaterial(definition: TreeDefinition, textures?: TextureOptions): MeshStandardNodeMaterial {
  const material = createShadedMaterial(definition.materials.shading);
  material.name = 'tree.js leaves';
  material.userData.treePart = 'leaves';
  material.color.set(definition.season.leafColor[0]!.value);
  material.vertexColors = true;
  material.side = DoubleSide;
  material.roughness = definition.materials.leaf.roughness;
  material.metalness = 0;
  applyLeafMap(material, definition.materials.leaf, textures);
  return material;
}
