import { uniform } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node, NodeMaterial, UniformNode } from 'three/webgpu';
import type { MaterialFeatures, TranslucencyDefinition, TreeDefinition } from '../definition';
import type { CrownVolume } from '../generator';
import { materialFeaturesOf } from '../styles/material-features';
import { applyCrownNormals } from './crown-normals';
import { applyLeafTranslucency } from './leaf-translucency-model';
import { applyStructuralOcclusion } from './occlusion';

type FloatUniform = UniformNode<'float', number>;

/** One tree's materials to give the Material Features (a Tree's, or one Forest Variant's). */
export interface MaterialFeatureTarget {
  /** The leaf material (Crown Normals, Leaf Translucency). */
  leaf: MeshStandardNodeMaterial;
  /** Every material of the tree: bark, leaf and Fruit (Structural Occlusion). */
  materials: readonly (NodeMaterial | null)[];
  /** The tree's Crown Volume (`TreeData.crown`). */
  crown: CrownVolume;
  /** The Growth node the materials' `positionNode` grows with. */
  growth: Node<'float'>;
  /** Turns a tree-space normal into the mesh's own space (a Forest rotates it by the instance). Default: as is. */
  toObject?: (normal: Node<'vec3'>) => Node<'vec3'>;
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * The Material Features (GLOSSARY, ADR 0008) of a Tree or Forest: applies those the Definition sets to
 * the materials of each target and owns their values as uniforms, shared by all targets, so a feature
 * that is on can be tuned live (no regeneration, no recompile). A feature that is off leaves the
 * materials exactly as they are and cannot be tuned (switching one on needs a new Tree or Forest).
 */
export class LiveMaterialFeatures {
  private readonly crown: FloatUniform | null;
  private readonly translucencyValues: { strength: FloatUniform; edge: FloatUniform; ambient: FloatUniform } | null;
  private readonly occlusion: FloatUniform | null;

  constructor(definition: TreeDefinition, targets: readonly MaterialFeatureTarget[]) {
    const { crownNormals, translucency, occlusion } = materialFeaturesOf(definition);
    this.crown = crownNormals ? uniform(crownNormals) : null;
    this.translucencyValues = translucency
      ? { strength: uniform(translucency.strength), edge: uniform(translucency.edge), ambient: uniform(translucency.ambient) }
      : null;
    this.occlusion = occlusion ? uniform(occlusion.strength) : null;
    for (const { leaf, materials, crown, growth, toObject } of targets) {
      if (this.crown) applyCrownNormals(leaf, this.crown, crown, growth, toObject);
      if (this.translucencyValues) applyLeafTranslucency(leaf, this.translucencyValues, crown, growth);
      if (this.occlusion) applyStructuralOcclusion(materials, this.occlusion);
    }
  }

  /** The features that are on, with their current values (same shape as `materialFeaturesOf`). */
  get values(): MaterialFeatures {
    return {
      ...(this.crown ? { crownNormals: this.crown.value } : {}),
      ...(this.translucencyValues
        ? {
            translucency: {
              strength: this.translucencyValues.strength.value,
              edge: this.translucencyValues.edge.value,
              ambient: this.translucencyValues.ambient.value,
            },
          }
        : {}),
      ...(this.occlusion ? { occlusion: { strength: this.occlusion.value } } : {}),
    };
  }

  /** Crown Normals amount, null when off. */
  get crownNormals(): number | null {
    return this.crown?.value ?? null;
  }

  /** Sets the Crown Normals amount (clamped to 0..1); throws when the feature is off. */
  set crownNormals(value: number) {
    if (!this.crown) {
      throw new Error('This tree has no Crown Normals: set `materials.leaf.crownNormals` in its Tree Definition to tune the amount');
    }
    this.crown.value = clamp01(value);
  }

  /** Leaf Translucency settings (a copy), null when off. */
  get translucency(): TranslucencyDefinition | null {
    return this.values.translucency ?? null;
  }

  /** Sets any of the Leaf Translucency settings (each clamped to 0..1; the others kept); throws when the feature is off. */
  set translucency(value: Partial<TranslucencyDefinition>) {
    if (!this.translucencyValues) {
      throw new Error('This tree has no Leaf Translucency: set `materials.leaf.translucency` in its Tree Definition to tune it');
    }
    for (const key of ['strength', 'edge', 'ambient'] as const) {
      const v = value[key];
      if (v !== undefined) this.translucencyValues[key].value = clamp01(v);
    }
  }

  /** Structural Occlusion strength, null when off. */
  get occlusionStrength(): number | null {
    return this.occlusion?.value ?? null;
  }

  /** Sets the Structural Occlusion strength (clamped to 0..1); throws when the feature is off. */
  set occlusionStrength(value: number) {
    if (!this.occlusion) {
      throw new Error('This tree has no Structural Occlusion: set `materials.occlusion` in its Tree Definition to tune its strength');
    }
    this.occlusion.value = clamp01(value);
  }
}
