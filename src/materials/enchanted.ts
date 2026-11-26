import { MeshStandardNodeMaterial, PhysicalLightingModel, type LightingModelDirectInput, type NodeBuilder } from 'three/webgpu';
import { diffuseColor, float, mix, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3 } from 'three/tsl';
import type { Node, Texture, UniformNode } from 'three/webgpu';
import type { InnerGlowDefinition, TreeDefinition } from '../definition';
import type { CrownVolume } from '../generator';
import { seasonLeafColorNode } from '../season/nodes';
import { crownNodes } from './crown-nodes';
import { directLight, lightingContext, translucencyDirect, translucencyIndirect, type LeafTranslucencyTerm } from './leaf-translucency';
import { BARK_REPEAT } from './maps';

/** Direct light is dimmed and cooled (moonlight), so the Inner Glow carries the tree. */
const DIRECT_TINT = [0.62, 0.7, 0.95] as const;
/** Ambient (sky, hemisphere) light: darker and bluer still. */
const AMBIENT_TINT = [0.45, 0.5, 0.78] as const;

/**
 * Enchanted lighting: three's physical model with dim, cool light (every direct light cooled, the ambient
 * darker and bluer), so trees read dark and blue-violet and their Inner Glow stands out. With a Leaf
 * Translucency term, leaves lit from behind glow too.
 */
export class EnchantedLightingModel extends PhysicalLightingModel {
  constructor(private readonly translucency: LeafTranslucencyTerm | null = null) {
    super();
  }

  /** Whether this model adds Leaf Translucency. */
  get isLeafTranslucencyModel(): boolean {
    return this.translucency !== null;
  }

  override direct(input: LightingModelDirectInput, builder: NodeBuilder): void {
    const { lightDirection, lightColor, reflectedLight } = directLight(input);
    const cool = lightColor.mul(vec3(...DIRECT_TINT));
    super.direct({ ...input, lightColor: cool } as unknown as LightingModelDirectInput, builder);
    if (this.translucency) reflectedLight.directDiffuse.addAssign(translucencyDirect(this.translucency, lightDirection, cool));
  }

  override indirect(builder: NodeBuilder): void {
    super.indirect(builder);
    const { reflectedLight } = lightingContext(builder);
    reflectedLight.indirectDiffuse.mulAssign(vec3(...AMBIENT_TINT));
    if (this.translucency) reflectedLight.indirectDiffuse.addAssign(translucencyIndirect(this.translucency, builder).mul(vec3(...AMBIENT_TINT)));
  }
}

/**
 * The enchanted Style's material (`materials.shading: 'enchanted'`): a `MeshStandardNodeMaterial` lit by
 * the enchanted model, so every part node (Season colour, Growth/Wind `positionNode`, Shader Hooks) and the
 * exporters work as for the other Styles. The Inner Glow is its emissive (`applyInnerGlow`).
 */
export class EnchantedNodeMaterial extends MeshStandardNodeMaterial {
  readonly isEnchantedMaterial = true;

  override setupLightingModel(): PhysicalLightingModel {
    return new EnchantedLightingModel();
  }
}

/** Seconds per Inner Glow pulse (one slow breath). */
export const INNER_GLOW_PERIOD = 7;
/** The pulse swings the glow between this share of its strength and the full strength. */
export const PULSE_LOW = 0.6;
/** The pulse's mean: the steady glow of a Baked Tree (which has no Wind clock to pulse with). */
export const STEADY_PULSE = (PULSE_LOW + 1) / 2;
/** How bright the glow is at strength 1: the leaves' glowing cards are mostly dark, so it is boosted. */
export const LEAF_GAIN = 2.6;
export const VEIN_GAIN = 1.8;
/** Leaves deep inside the crown keep this share of their glow; the thin edge of the Crown Volume glows fully. */
const CROWN_CORE = 0.3;
/** From this distance from the Crown Volume's centre (1 = its surface) the leaves' glow rises towards the edge. */
const EDGE_START = 0.35;

/** How much of its glow a leaf at `distance` (`crownAt(...).distance`) shows: `crownEdgeGlow`'s CPU twin. */
export function crownEdgeGlowAt(distance: number): number {
  const t = Math.min(Math.max((distance - EDGE_START) / (1 - EDGE_START), 0), 1);
  return CROWN_CORE + (1 - CROWN_CORE) * t * t * (3 - 2 * t);
}

/** How much of its glow a leaf at `distance` from the Crown Volume's centre shows: strongest at the thin edge. */
export const crownEdgeGlow = (distance: Node<'float'>): Node<'float'> => mix(float(CROWN_CORE), float(1), smoothstep(EDGE_START, 1, distance));

/** The pulse (PULSE_LOW..1) at Wind time `time` (seconds) and phase (radians). */
export function innerGlowPulse(time: Node<'float'>, phase: Node<'float'>): Node<'float'> {
  const wave = sin(time.mul((2 * Math.PI) / INNER_GLOW_PERIOD).add(phase));
  return mix(float(PULSE_LOW), float(1), wave.mul(0.5).add(0.5));
}

/** The bark veins: the bark map's alpha, sampled as the bark is (1 = vein). */
export const barkVeins = (map: Texture): Node<'float'> => texture(map, uv().mul(vec2(...BARK_REPEAT))).a as Node<'float'>;

/** The leaves' Inner Glow before the pulse: their drawn colour × `leaf`, × `share` (how much of its glow the leaf shows). */
export const leafGlowNode = (strength: InnerGlowUniforms, share: Node<'float'>): Node<'vec3'> =>
  diffuseColor.rgb.mul(strength.leaf.mul(LEAF_GAIN)).mul(share) as Node<'vec3'>;

/** The bark veins' Inner Glow before the pulse: `colour` (the Season leaf colour) × the vein mask × `veins`. */
export const veinGlowNode = (strength: InnerGlowUniforms, colour: Node<'vec3'>, vein: Node<'float'>): Node<'vec3'> =>
  colour.mul(vein).mul(strength.veins.mul(VEIN_GAIN)) as Node<'vec3'>;

/** The Inner Glow strengths as uniforms (shared by every material of a Tree or Forest, tunable live). */
export interface InnerGlowUniforms {
  leaf: UniformNode<'float', number>;
  veins: UniformNode<'float', number>;
}

/** The Inner Glow a tree draws: its Definition's, when the shading is `enchanted`; null otherwise (other shadings ignore it). */
export const innerGlowOf = (definition: TreeDefinition): InnerGlowDefinition | null =>
  (definition.materials.shading === 'enchanted' && definition.materials.innerGlow) || null;

export const innerGlowUniforms = (glow: InnerGlowDefinition): InnerGlowUniforms => ({ leaf: uniform(glow.leaf), veins: uniform(glow.veins) });

/** One tree's materials and inputs to give the Inner Glow (a Tree's, or one Forest Variant's). */
export interface InnerGlowTarget {
  bark: MeshStandardNodeMaterial;
  leaf: MeshStandardNodeMaterial;
  /** The per-tree Definition (`definitionForSeed`): its Season leaf colour is the glow's colour. */
  definition: TreeDefinition;
  /** The tree's Crown Volume (`TreeData.crown`) and the Growth node its materials grow with. */
  crown: CrownVolume;
  growth: Node<'float'>;
  /** The tree's Season (a Tree's uniform, a Forest's per-instance Season). */
  season: Node<'float'>;
  /** The shared Wind time (seconds) the glow pulses with. */
  time: Node<'float'>;
  /** The tree's pulse phase (radians), from its Seed. */
  phase: Node<'float'>;
}

/**
 * Inner Glow (GLOSSARY) as the materials' emissive, so it shines with no light on the tree:
 * - leaves: their own colour (Season colour × the Seed's tint × the glowing card, bright veins and edge,
 *   dark centre) × `leaf`, strongest at the thin edge of the Crown Volume;
 * - bark: the tree's Season leaf colour (with its Leaf Palette) where the bark map's alpha marks a vein,
 *   × `veins` (no map, no veins);
 * both pulsing slowly with the Wind time, out of phase per tree. Impostors draw it from their atlases
 * (`impostor-material.ts`); a Baked Tree exports it steady, at the pulse's mean (`STEADY_PULSE`).
 */
export function applyInnerGlow(strength: InnerGlowUniforms, { bark, leaf, definition, crown, growth, season, time, phase }: InnerGlowTarget): void {
  const pulse = innerGlowPulse(time, phase);
  const edge = crownEdgeGlow(crownNodes(crown, growth).distance);
  leaf.emissiveNode = leafGlowNode(strength, edge).mul(pulse);
  if (bark.map) {
    const colour = varying(seasonLeafColorNode(definition.season, season)) as unknown as Node<'vec3'>;
    bark.emissiveNode = veinGlowNode(strength, colour, barkVeins(bark.map)).mul(pulse);
  }
  bark.needsUpdate = true;
  leaf.needsUpdate = true;
}
