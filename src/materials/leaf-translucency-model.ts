import {
  PhysicalLightingModel,
  type LightingModelDirectInput,
  type MeshStandardNodeMaterial,
  type Node,
  type NodeBuilder,
} from 'three/webgpu';
import type { CrownVolume } from '../generator';
import {
  directLight,
  leafTranslucencyTerm,
  lightingContext,
  translucencyDirect,
  translucencyIndirect,
  type LeafTranslucencyTerm,
  type LeafTranslucencyValues,
} from './leaf-translucency';
import { PaintedNodeMaterial } from './painted';
import { SoftToonLightingModel, SoftToonNodeMaterial } from './toon';
import { WhimsicalLightingModel, WhimsicalNodeMaterial } from './whimsical';

/**
 * three's physical lighting model plus Leaf Translucency (flat and standard leaf materials): everything
 * the physical model does, and per light and for the indirect light the shared translucency term.
 * Only the public `direct` / `indirect` entry points are extended.
 */
class TranslucentLightingModel extends PhysicalLightingModel {
  readonly isLeafTranslucencyModel = true;

  constructor(private readonly translucency: LeafTranslucencyTerm) {
    super();
  }

  override direct(input: LightingModelDirectInput, builder: NodeBuilder): void {
    super.direct(input, builder);
    const { lightDirection, lightColor, reflectedLight } = directLight(input);
    reflectedLight.directDiffuse.addAssign(translucencyDirect(this.translucency, lightDirection, lightColor));
  }

  override indirect(builder: NodeBuilder): void {
    // The physical model's own AO step has run by now; the term multiplies in the AO itself.
    super.indirect(builder);
    lightingContext(builder).reflectedLight.indirectDiffuse.addAssign(translucencyIndirect(this.translucency, builder));
  }
}

/**
 * Gives a leaf material Leaf Translucency (`materials.leaf.translucency` as uniforms, a Material Feature, ADR 0008):
 * its lighting model becomes the translucent one (the physical model with the term for flat and standard
 * shading, the soft toon model with the same term for toon, the whimsical model with it for whimsical, the painted model's own term for painted). The material keeps its class and every node.
 * Only call it when the feature is set: without it the leaf material keeps today's lighting model.
 *
 * `crown` is the tree's Crown Volume (`TreeData.crown`); `growth` the Growth node the material's
 * `positionNode` grows with (a Tree's Growth uniform, or a Forest's per-instance Growth).
 */
export function applyLeafTranslucency(
  material: MeshStandardNodeMaterial,
  values: LeafTranslucencyValues,
  crown: CrownVolume,
  growth: Node<'float'>,
): void {
  applyLeafTranslucencyTerm(material, leafTranslucencyTerm(values, crown, growth));
}

/**
 * Gives `material` the translucent lighting model for a ready-made term (`applyLeafTranslucency` builds
 * it from a tree's vertices; an Impostor from its baked Crown Volume distance).
 */
export function applyLeafTranslucencyTerm(material: MeshStandardNodeMaterial, term: LeafTranslucencyTerm): void {
  if (material instanceof PaintedNodeMaterial) {
    // The painted model takes the same term (and keeps its own lighting).
    material.translucency = term;
    material.needsUpdate = true;
    return;
  }
  const model =
    material instanceof SoftToonNodeMaterial
      ? () => new SoftToonLightingModel(term)
      : material instanceof WhimsicalNodeMaterial
        ? () => new WhimsicalLightingModel(term)
        : () => new TranslucentLightingModel(term);
  // The declared return type is the physical model; the renderer only uses the LightingModel interface.
  material.setupLightingModel = () => model() as unknown as PhysicalLightingModel;
  material.needsUpdate = true;
}
