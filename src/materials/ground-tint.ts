import { color, float, mix, positionGeometry, smoothstep, varying } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { GroundTintDefinition } from '../definition';
import { growthPosition } from '../growth';

/**
 * Ground Tint (GLOSSARY): how far the bark blends towards `tint.color` at tree-space height `y`
 * (on the grown tree): `strength` at and below the ground, easing (smoothstep) to 0 at `height`.
 */
export function groundTintAmount(tint: GroundTintDefinition, y: number): number {
  const t = Math.min(Math.max(y / tint.height, 0), 1);
  return tint.strength * (1 - t * t * (3 - 2 * t));
}

/**
 * The TSL twin of {@link groundTintAmount}, applied to a bark colour node: `mix(bark, tint, amount)`.
 * The height is the grown tree-space position (Growth `growth`, before Wind), from the vertex stage.
 */
export function applyGroundTint(bark: Node<'vec3'> | Node<'color'>, tint: GroundTintDefinition, growth: Node<'float'>): Node<'vec3'> {
  const y = varying(growthPosition(growth, positionGeometry).y);
  const amount = float(1).sub(smoothstep(0, tint.height, y)).mul(tint.strength);
  return mix(bark, color(tint.color), amount);
}
