import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, uv, float } from 'three/tsl';
import type { TreeDefinition } from '../definition';

/**
 * Bark material: a TSL node material (ADR 0002). Growth/Season/Wind uniforms and
 * per-Style variants hook in here in later tickets (#5-#10).
 */
export function createBarkMaterial(definition: TreeDefinition): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = 'tree.js bark';
  const base = color(definition.bark.color);
  // Slightly darker towards the base for a little depth, purely in TSL.
  material.colorNode = mix(base.mul(0.75), base, uv().y.clamp(0, 1).pow(float(0.5)));
  material.roughness = 0.9;
  material.metalness = 0;
  return material;
}
