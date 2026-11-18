import { float, length, normalize, positionGeometry, select, varying, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { CrownVolume } from '../generator';
import { growthPosition, growthScale } from '../growth';

/** The Crown Volume measured at a point of the tree, in TSL (fragment stage). */
export interface CrownNodes {
  /**
   * Unit outward normal of the Volume's ellipsoid through the point, in tree space (twin of `crownNormal`).
   * Straight up at the centre. Turn it into view space with `transformNormalToView` (a Forest first
   * rotates it by the instance).
   */
  normal: Node<'vec3'>;
  /** How far the point sits from the centre in units of the ellipsoid: 0 centre, 1 shell (twin of `crownDistance`). */
  distance: Node<'float'>;
}

/**
 * The Crown Volume (GLOSSARY) measured at the grown tree-space position (Growth `growth`, before Wind,
 * so Wind doesn't make it flicker). The Volume scales with the tree's Growth scale, as the vertices do,
 * so a sapling is measured against its own, smaller crown. Shared by the Material Features.
 */
export function crownNodes(crown: CrownVolume, growth: Node<'float'>): CrownNodes {
  const grown = varying(growthPosition(growth, positionGeometry), 'vCrownPosition');
  // Grown position back in the fully grown tree's frame: the Volume itself scaled by the Growth scale.
  const local = grown.div(growthScale(float(growth).clamp(0, 1))).sub(vec3(...crown.center));
  const radii = vec3(...crown.radii);
  const unit = local.div(radii);
  const gradient = unit.div(radii);
  const normal = select(length(gradient).greaterThan(1e-6), normalize(gradient), vec3(0, 1, 0));
  return { normal, distance: length(unit) };
}
