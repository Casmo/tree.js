import { attribute, float, mix } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';

/**
 * Structural Occlusion (GLOSSARY, ADR 0008) on a tree's own materials: each material's `aoNode` becomes
 * `mix(1, aOcclusion, strength)`, from the Generator's baked `aOcclusion` (only generated when
 * `materials.occlusion` is set). three applies it as it does the material's built-in AO (multiplied with an
 * app's SSAO/GTAO through `context.getAO`), so it only darkens ambient and indirect light; the toon model's
 * indirect light multiplies by it too. `strength` is a uniform, so tuning it needs no recompile.
 */
export function applyStructuralOcclusion(materials: readonly (NodeMaterial | null)[], strength: Node<'float'>): void {
  const ao = mix(float(1), attribute<'float'>('aOcclusion', 'float'), strength);
  for (const material of materials) if (material) material.aoNode = ao;
}
