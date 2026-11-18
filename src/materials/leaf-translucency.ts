import type { LightingModelDirectInput, Node, NodeBuilder } from 'three/webgpu';
import { BRDF_Lambert, diffuseColor, float, mix, positionViewDirection, uniform } from 'three/tsl';
import type { TranslucencyDefinition } from '../definition';
import type { CrownVolume } from '../generator';
import { crownNodes } from './crown-nodes';

/*
 * @types/three leaves the lighting model's inputs untyped (`builder.context` is `unknown`, the light's
 * nodes and the reflected light are plain `Node`s). These name the fields the translucent models use,
 * with the node types three gives them.
 */

/** The diffuse parts of the reflected light a lighting model adds to (RGB). */
export interface DiffuseLight {
  directDiffuse: Node<'vec3'>;
  indirectDiffuse: Node<'vec3'>;
}

/** The part of three's lighting context (`builder.context` in a lighting model) the terms read and write. */
export interface LightingContext {
  irradiance: Node<'vec3'>;
  ambientOcclusion: Node<'float'>;
  reflectedLight: DiffuseLight;
}

/** One direct light as a lighting model's `direct` gets it: view-space direction, colour (with shadow). */
export interface DirectLight {
  lightDirection: Node<'vec3'>;
  lightColor: Node<'vec3'>;
  reflectedLight: DiffuseLight;
}

/** The lighting context of a lighting model's builder, typed (see {@link LightingContext}). */
export const lightingContext = (builder: NodeBuilder): LightingContext => builder.context as LightingContext;

/** A lighting model's `direct` input, typed (see {@link DirectLight}). */
export const directLight = (input: LightingModelDirectInput): DirectLight => input as unknown as DirectLight;

/**
 * How narrow the Leaf Translucency lobe (light from behind the leaf) is: `back = saturate(dot(V, -L))^BACK_POWER`. Higher = only when
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
  readonly strength: Node<'float'>;
  /** Indirect (sky) glow (0..1). */
  readonly ambient: Node<'float'>;
  /** Extra glow at the thin edge of the Crown Volume (0..1). */
  readonly edge: Node<'float'>;
  /** How thin the crown is at this fragment: 1 on (or outside) the Crown Volume's shell, towards 0 at its centre. */
  readonly thinness: Node<'float'>;
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
export function leafTranslucencyTerm(settings: TranslucencyDefinition, crown: CrownVolume, growth: Node<'float'>): LeafTranslucencyTerm {
  return {
    strength: uniform(settings.strength),
    ambient: uniform(settings.ambient),
    edge: uniform(settings.edge),
    thinness: crownNodes(crown, growth).distance.clamp(0, 1),
  };
}

/** `mix(1, thinness, edge)`: 1 everywhere at edge 0, only the crown's thin edge glows at edge 1. */
const edgeBoost = (term: LeafTranslucencyTerm): Node<'float'> => mix(float(1), term.thinness, term.edge);

/**
 * Direct light shining through the leaf towards the viewer, for one light (add it to `directDiffuse`):
 * `lightColor × leaf diffuse × strength × back × edgeBoost`, where `back` is a smooth power of
 * dot(view direction, -light direction). `lightColor` already carries the light's shadow, so shadowed
 * leaves don't glow. The leaf diffuse is its Season colour (Season Profile x the Seed's tint x leaf map).
 * Unlike the lit side it has no Lambert 1/pi: like a real leaf against the sun, a strongly translucent leaf
 * glows brighter than one lit from the front.
 */
export function translucencyDirect(term: LeafTranslucencyTerm, lightDirection: Node<'vec3'>, lightColor: Node<'vec3'>): Node<'vec3'> {
  const back = positionViewDirection.dot(lightDirection.negate()).clamp(0, 1).pow(BACK_POWER);
  return lightColor
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
export function translucencyIndirect(term: LeafTranslucencyTerm, builder: NodeBuilder): Node<'vec3'> {
  const { ambientOcclusion, irradiance } = lightingContext(builder);
  return irradiance
    // BRDF_Lambert is declared as an untyped OperatorNode; it is the RGB diffuse / pi.
    .mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb }) as unknown as Node<'vec3'>)
    .mul(term.ambient)
    .mul(edgeBoost(term))
    .mul(ambientOcclusion);
}
