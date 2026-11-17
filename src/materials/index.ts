import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, uv, float } from 'three/tsl';
import type { TreeDefinition } from '../definition';

/**
 * Bark material: a TSL node material (ADR 0002). Growth/Season/Wind uniforms and
 * per-Style variants hook in here in later tickets (#5-#10).
 */
export function createBarkMaterial(definition: TreeDefinition): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'tree.js bark';
  const base = color(definition.materials.bark.color);
  // Slightly darker towards the base for a little depth, purely in TSL.
  material.colorNode = mix(base.mul(0.75), base, uv().y.clamp(0, 1).pow(float(0.5)));
  material.roughness = definition.materials.bark.roughness;
  material.metalness = 0;
  return material;
}

/**
 * Leaf material: a TSL node material lit from both sides. `.color` is the Season Profile's
 * leaf colour at Season 0 (what exporters see); `Tree` adds the Season nodes
 * (`applySeasonToLeafMaterial`), whose colour is multiplied by the per-leaf vertex colours (the Seed's tint).
 */
export function createLeafMaterial(definition: TreeDefinition): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'tree.js leaves';
  material.color.set(definition.season.leafColor[0]!.value);
  material.vertexColors = true;
  material.side = DoubleSide;
  material.roughness = definition.materials.leaf.roughness;
  material.metalness = 0;
  return material;
}
