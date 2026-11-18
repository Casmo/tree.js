import { attribute, float, mix, uniform } from 'three/tsl';
import type { NodeMaterial, UniformNode } from 'three/webgpu';
import type { TreeDefinition } from '../definition';

/** The Structural Occlusion strength a Tree or Forest tunes live (a uniform: no regeneration, no recompile). */
export type OcclusionStrengthUniform = UniformNode<'float', number>;

/**
 * Structural Occlusion (GLOSSARY, ADR 0008) on a tree's own materials: when `materials.occlusion` is set,
 * each material's `aoNode` becomes `mix(1, aOcclusion, strength)`, from the Generator's baked `aOcclusion`.
 * three applies it as it does the material's built-in AO (multiplied with an app's SSAO/GTAO through
 * `context.getAO`), so it only darkens ambient and indirect light; the toon model's indirect light
 * multiplies by it too. Returns the strength uniform, or null (and leaves the materials untouched)
 * when the Definition has no Structural Occlusion.
 */
export function applyStructuralOcclusion(
  definition: TreeDefinition,
  materials: readonly (NodeMaterial | null)[],
): OcclusionStrengthUniform | null {
  const { occlusion } = definition.materials;
  if (!occlusion) return null;
  const strength = uniform(occlusion.strength);
  const ao = mix(float(1), attribute<'float'>('aOcclusion', 'float'), strength);
  for (const material of materials) if (material) material.aoNode = ao;
  return strength;
}

/** Writes a new strength (clamped to 0..1) into the uniform; a tree without Structural Occlusion has none to tune. */
export function setOcclusionStrength(strength: OcclusionStrengthUniform | null, value: number): void {
  if (!strength) {
    throw new Error('This tree has no Structural Occlusion: set `materials.occlusion` in its Tree Definition to tune its strength');
  }
  strength.value = Math.min(Math.max(value, 0), 1);
}
