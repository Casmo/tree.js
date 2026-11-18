import type { NodeBuilder } from 'three/webgpu';
import { BRDF_Lambert, diffuseColor, float, mix, positionViewDirection, uniform } from 'three/tsl';
import type { TranslucencyDefinition } from '../definition';
import type { CrownVolume } from '../generator';
import { crownNodes } from './crown';

// TSL node types are loosely typed in @types/three; keep our own alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/**
 * How narrow the back-light lobe is: `back = saturate(dot(V, -L))^BACK_POWER`. Higher = only when
 * looking almost straight into the light through the leaf.
 */
const BACK_POWER = 3;

/**
 * Leaf Translucency (GLOSSARY) as one shared TSL term, used by both leaf lighting models: the physical
 * one (`TranslucentLightingModel`, flat and standard shading) and `SoftToonLightingModel` (toon).
 * Build it with {@link leafTranslucencyTerm}; the values are uniforms, so changing them needs no recompile.
 */
export interface LeafTranslucencyTerm {
  /** Direct glow per light (0..1). */
  readonly strength: Node;
  /** Indirect (sky) glow (0..1). */
  readonly ambient: Node;
  /** Extra glow at the thin edge of the Crown Volume (0..1). */
  readonly edge: Node;
  /** How thin the crown is at this fragment: 1 on (or outside) the Crown Volume's shell, towards 0 at its centre. */
  readonly thinness: Node;
}

/**
 * The term for a leaf material: `settings` from `materials.leaf.translucency`, `crown` the tree's
 * Crown Volume (`TreeData.crown`, tree space, fully grown) and `growth` the Growth node the material
 * grows with (the Tree's uniform, or a Forest's per-instance Growth).
 *
 * Thinness is the Crown Volume distance (`crownNodes`): measured in the tree's own space on the grown
 * position before Wind (so Wind doesn't make it flicker), against the Volume scaled by the same Growth scale
 * the vertices get. Being in tree space, it is the same for every Forest instance whatever its rotation and
 * scale. It needs no vertex attribute.
 */
export function leafTranslucencyTerm(settings: TranslucencyDefinition, crown: CrownVolume, growth: Node): LeafTranslucencyTerm {
  return {
    strength: uniform(settings.strength),
    ambient: uniform(settings.ambient),
    edge: uniform(settings.edge),
    thinness: crownNodes(crown, growth).distance.clamp(0, 1),
  };
}

/** `mix(1, thinness, edge)`: 1 everywhere at edge 0, only the crown's thin edge glows at edge 1. */
const edgeBoost = (term: LeafTranslucencyTerm): Node => mix(float(1), term.thinness, term.edge);

/**
 * Direct light shining through the leaf towards the viewer, for one light (add it to `directDiffuse`):
 * `lightColor × leaf diffuse × strength × back × edgeBoost`, where `back` is a smooth power of
 * dot(view direction, -light direction). `lightColor` already carries the light's shadow, so shadowed
 * leaves don't glow. The leaf diffuse is its Season colour (Season Profile x the Seed's tint x leaf map).
 * Unlike the lit side it has no Lambert 1/pi: like a real leaf against the sun, a strongly translucent leaf
 * glows brighter than one lit from the front.
 */
export function translucencyDirect(term: LeafTranslucencyTerm, lightDirection: Node, lightColor: Node): Node {
  const back = (positionViewDirection as Node).dot((lightDirection as Node).negate()).clamp(0, 1).pow(BACK_POWER);
  return (lightColor as Node)
    .mul(diffuseColor.rgb)
    .mul(term.strength)
    .mul(back)
    .mul(edgeBoost(term));
}

/**
 * Indirect light shining through the leaf (add it to `indirectDiffuse` after the model's own AO step):
 * `irradiance × leaf diffuse × ambient × edgeBoost × ambient occlusion`, the leaf diffuse through the
 * Lambert BRDF like the rest of the indirect light.
 *
 * The irradiance from behind would be the irradiance sampled along the flipped normal; three's public
 * lighting-model API only exposes the irradiance already gathered along the normal (`context.irradiance`),
 * so that stands in for it. It is exact for ambient light and light probes' constant part; under a
 * hemisphere light it reads the side facing the viewer.
 */
export function translucencyIndirect(term: LeafTranslucencyTerm, builder: NodeBuilder): Node {
  const { ambientOcclusion, irradiance } = (builder as Node).context;
  return irradiance
    .mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb }))
    .mul(term.ambient)
    .mul(edgeBoost(term))
    .mul(ambientOcclusion);
}
