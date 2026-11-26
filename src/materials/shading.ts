import { MeshStandardNodeMaterial } from 'three/webgpu';
import { isPaintedShading, type Shading } from '../definition';
import { PaintedNodeMaterial } from './painted';
import { SoftToonNodeMaterial } from './toon';
import { EnchantedNodeMaterial } from './enchanted';
import { WhimsicalNodeMaterial } from './whimsical';

/**
 * The Style layer of the tree materials: the base node material for a Definition's
 * `materials.shading`. `createBarkMaterial` / `createLeafMaterial` start from it and then set
 * their part-specific nodes (bark colour, Season colour, Growth/Wind `positionNode`), so those
 * shared nodes work the same in every Style.
 *
 * - `flat` (low-poly): faceted lighting from the screen-space face normal (`flatShading`), so
 *   facets stay correct when Growth or Wind move vertices in `positionNode`. Rough, no gloss.
 * - `standard` (realistic): smooth PBR shading.
 * - `toon` (stylized): soft two-tone toon lighting (`SoftToonNodeMaterial`, still a standard
 *   node material underneath), smooth normals so leaf clumps read as rounded.
 * - `painted` (painterly): soft, warm wrap lighting without bands or specular (`PaintedNodeMaterial`);
 *   a Leaf Mass crown is painted onto its gradient (`paintLeafMasses`).
 * - `stylized-painted` (stylized painterly): the same as `painted`.
 * - `whimsical` (whimsical): three crisp toon tones and a coloured rim light (`WhimsicalNodeMaterial`);
 *   the bark gets candy stripes in the tree's accent colour (`createBarkMaterial`).
 * - `enchanted` (enchanted): dim, cool physical lighting (`EnchantedNodeMaterial`); a Tree or Forest adds
 *   the Inner Glow as its emissive (`applyInnerGlow`).
 */
export function createShadedMaterial(shading: Shading): MeshStandardNodeMaterial {
  const material =
    shading === 'toon'
      ? new SoftToonNodeMaterial()
      : isPaintedShading(shading)
        ? new PaintedNodeMaterial()
        : shading === 'whimsical'
          ? new WhimsicalNodeMaterial()
          : shading === 'enchanted'
            ? new EnchantedNodeMaterial()
            : new MeshStandardNodeMaterial();
  material.flatShading = shading === 'flat';
  return material;
}

/** Whether a shading model wants solid (flat) colours rather than smooth colour gradients. */
export const isFlatShading = (shading: Shading): boolean => shading === 'flat';
