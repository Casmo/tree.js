import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Shading } from '../definition';

/**
 * The Style layer of the tree materials: the base node material for a Definition's
 * `materials.shading`. `createBarkMaterial` / `createLeafMaterial` start from it and then set
 * their part-specific nodes (bark colour, Season colour, Growth/Wind `positionNode`), so those
 * shared nodes work the same in every Style.
 *
 * - `flat` (low-poly): faceted lighting from the screen-space face normal (`flatShading`), so
 *   facets stay correct when Growth or Wind move vertices in `positionNode`. Rough, no gloss.
 * - `standard` (realistic): smooth PBR shading.
 * - `toon` (stylized): standard until the stylized Style ships its own toon material.
 */
export function createShadedMaterial(shading: Shading): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.flatShading = shading === 'flat';
  return material;
}

/** Whether a shading model wants solid (flat) colours rather than smooth colour gradients. */
export const isFlatShading = (shading: Shading): boolean => shading === 'flat';
