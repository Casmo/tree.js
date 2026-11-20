import {
  LightingModel,
  MeshStandardNodeMaterial,
  PropertyNode,
  type LightingModelDirectInput,
  type NodeBuilder,
  type PhysicalLightingModel,
} from 'three/webgpu';
import {
  attribute,
  BRDF_Lambert,
  color,
  diffuseColor,
  float,
  mix,
  normalGeometry,
  normalView,
  smoothstep,
  transformNormalToView,
  vec3,
  vec4,
} from 'three/tsl';
import { hypot3, smoothstep as smoothstepNumber } from '../math';
import { hexToLinear } from '../season/profile';
import { translucencyDirect, translucencyIndirect, type LeafTranslucencyTerm } from './leaf-translucency';

// TSL node types are loosely typed in @types/three; keep our own alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

// The painted look (Painterly, ADR 0014), tuned on concept D "medium".
/** Wrap lighting: how far light reaches round the shaded side, in N·L (0 = Lambert, 1 = half-Lambert). */
export const WRAP = 0.5;
/** How far a Leaf Mass card's normal bends from the card's own towards its mass's (`aMass`), 0..1. */
export const BEND = 0.85;
/** How strongly the spray texture paints: how far its paint value moves the gradient, how dark the gaps between leaves get. */
export const SPRAY_STRENGTH = 0.6;
/** How far direct light moves a leaf up the gradient (towards the warm tips). */
export const SUNLIT = 0.35;
/**
 * How much of a received shadow a Leaf Mass card shows: a little. Cards shadowing each other read as
 * speckles; the painted gradient already darkens the inside of the masses (concepts, ADR 0014).
 */
export const LEAF_SHADOW = 0.3;
/**
 * The sunlit tips of the leaf gradient (#116): the leaf colour, brighter, plus warm sunlight. Added, not
 * mixed towards a fixed yellow-green, so the tips stay the Season's own hue: yellow-green in summer, gold
 * and orange in autumn. Light (pale) colours, fresh spring green and blossom, fade towards a pale cream.
 */
const TIP_GAIN = 1.25;
const TIP_SUN = [0.15, 0.13, 0] as const;
const TIP_PALE = [1, 0.97, 0.8] as const;
/** How much the tips of a light leaf colour fade to {@link TIP_PALE} (by its luminance, see `paintedTip`). */
const TIP_PALENESS = 0.45;
/** The deep inside of the leaf gradient: the leaf colour times this, cool, mixed a little towards {@link DEEP_COLOR}. */
const DEEP = [0.22, 0.32, 0.45] as const;
/** {@link DEEP} for light leaf colours (spring, blossom): lighter and less blue, so they stay pale. */
const DEEP_PALE = [0.42, 0.42, 0.46] as const;
const DEEP_COLOR = '#0b2427';
/** Per-mass tint at either end of its random number: some masses a little warmer, some a little cooler. */
const MASS_WARMER = [1.05, 1, 0.92] as const;
const MASS_COOLER = [0.95, 1, 1.06] as const;
/** Direct light warms bark and Fruit a little (multiplier on the lit colour). */
export const WARM = [1.06, 1.02, 0.9] as const;

// The crown gradient, shared by the shader (`leafMassPaint`, `paintGradient`, `paintedTip`) and its CPU twin
// for the Baked Tree (`paintLeafColor`): change a number here and both follow.
/**
 * Where a Leaf Mass fragment sits on the crown gradient before light (`LeafMassPaint.shade`, about -1..1):
 * `offset`, plus its height in the crown (0..1), the up-ness of its lighting normal (0 facing down .. 1 up) and
 * its tip light about 0.5, minus how buried it is, plus the spray's paint value about 0.5 (times
 * {@link SPRAY_STRENGTH}), each times its weight.
 */
export const SHADE = { offset: -0.06, height: 0.2, up: 0.34, tipLight: 0.25, buried: 0.6, spray: 0.9 } as const;
/** The gaps between painted leaves (the spray's uncovered texels) are multiplied by this at full {@link SPRAY_STRENGTH}. */
export const GAP_DARK = 0.6;
/** The middle of the gradient: the leaf colour, this much brighter. */
const MID_GAIN = 1.12;
/** The gradient's two blends over its place t (0..1): deep to middle, then middle to tip (smoothstep edges). */
const TO_MID = [0, 0.55] as const;
const TO_TIP = [0.5, 1] as const;
/** A leaf colour counts as light (pale: fresh spring green, blossom) from the first to the second luminance (smoothstep). */
const PALE = [0.2, 0.6] as const;
/** How far the deep inside mixes towards {@link DEEP_COLOR}: for a dark and for a light leaf colour. */
const DEEP_TOWARDS = { dark: 0.35, pale: 0.15 } as const;
/** Per-mass lightness: a mass's random number moves its brightness by up to ± half of this. */
const MASS_LIGHTNESS = 0.12;
/** Rec. 709 luminance weights (linear rgb). */
const LUMINANCE = [0.2126, 0.7152, 0.0722] as const;

/** The unpainted colour (Season x tint x texture) of the current fragment: what the painted gradient starts from. */
const paintBase = new PropertyNode('vec3', 'PaintBase');

/**
 * Paints a leaf: maps its Season colour `base` onto the crown gradient (deep, cool green inside and under the
 * Leaf Masses, the leaf colour in the middle, warm yellow-green on the tips and tops). `lit` (0..1) moves it
 * up the gradient, as direct light does. Built relative to `base`, so the gradient follows the Season.
 */
export type LeafPaint = (base: Node, lit: Node) => Node;

/**
 * The painted shading model (`materials.shading: 'painted'`, the painterly Style): soft, warm wrap
 * lighting, no toon bands and no specular. A `MeshStandardNodeMaterial` underneath, so every part node
 * (Season colour, Growth/Wind `positionNode`, Shader Hooks) works as in the other Styles.
 * With a `paint` (leaves of a Leaf Mass crown), the diffuse colour is painted onto the crown gradient,
 * and direct light moves it towards the warm tips.
 */
export class PaintedNodeMaterial extends MeshStandardNodeMaterial {
  readonly isPaintedMaterial = true;
  /** The leaf gradient, or null (bark, Fruit): the colour as it is, warmed by direct light. */
  paint: LeafPaint | null = null;
  /**
   * How much of the fragment `paint` paints (0..1), or null: all of it. An Impostor paints its leaf
   * texels and warms its wood ones.
   */
  paintAmount: Node | null = null;
  /** A Leaf Mass crown's paint inputs (`paintLeafMasses`), or null; an Impostor bakes them. */
  massPaint: LeafMassPaint | null = null;
  /** Leaf Translucency (a Material Feature), or null. */
  translucency: LeafTranslucencyTerm | null = null;

  override setupDiffuseColor(builder: NodeBuilder): void {
    super.setupDiffuseColor(builder);
    (paintBase as Node).assign(diffuseColor.rgb);
    if (this.paint) (diffuseColor as Node).assign(vec4(this.painted(paintBase, float(0)), diffuseColor.a));
  }

  /** `paint` applied by `paintAmount` (the colour as it is elsewhere). */
  private painted(base: Node, lit: Node): Node {
    const painted = this.paint!(base, lit);
    return this.paintAmount ? mix(base, painted, this.paintAmount) : painted;
  }

  override setupLightingModel(): PhysicalLightingModel {
    // The declared return type is the physical model; the renderer only uses the LightingModel interface.
    return new PaintedLightingModel(this.paint, this.translucency, this.paintAmount) as unknown as PhysicalLightingModel;
  }
}

/**
 * Soft wrap diffuse (`((N·L + w) / (1 + w))`, smoothstepped) per light, plain diffuse ambient and
 * hemisphere light times AO. The lit colour is the painted one moved up the gradient (leaves) or warmed (others).
 */
export class PaintedLightingModel extends LightingModel {
  constructor(
    private readonly paint: LeafPaint | null = null,
    private readonly translucency: LeafTranslucencyTerm | null = null,
    /** Where `paint` paints only partly (0..1): the rest is warmed as bark is. */
    private readonly paintAmount: Node | null = null,
  ) {
    super();
  }

  /** Whether this model adds Leaf Translucency. */
  get isLeafTranslucencyModel(): boolean {
    return this.translucency !== null;
  }

  override direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput): void {
    const soft = smoothstep(0, 1, normalView.dot(lightDirection as Node).add(WRAP).div(1 + WRAP)); // as `wrapLight`
    const warm = (base: Node) => mix(base, base.mul(vec3(...WARM)), soft);
    const painted = this.paint?.(paintBase, soft.mul(SUNLIT));
    const lit = !painted ? warm(diffuseColor.rgb) : this.paintAmount ? mix(warm(paintBase), painted, this.paintAmount) : painted;
    (reflectedLight.directDiffuse as Node).addAssign((lightColor as Node).mul(soft).mul(BRDF_Lambert({ diffuseColor: lit })));
    if (this.translucency) (reflectedLight.directDiffuse as Node).addAssign(translucencyDirect(this.translucency, lightDirection as Node, lightColor as Node));
  }

  override indirect(builder: NodeBuilder): void {
    const { ambientOcclusion, irradiance, reflectedLight } = (builder as Node).context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
    if (this.translucency) reflectedLight.indirectDiffuse.addAssign(translucencyIndirect(this.translucency, builder));
  }
}

const luminanceOf = (c: Node): Node => c.dot(vec3(...LUMINANCE));

/** The warm, sunlit tip colour of the leaf gradient for the (linear) leaf colour `base`: see {@link TIP_GAIN}. */
function paintedTip(base: Node): Node {
  const sunlit = base.mul(TIP_GAIN).add(vec3(...TIP_SUN));
  const cream = vec3(...TIP_PALE).mul(luminanceOf(sunlit).max(0.5));
  return mix(sunlit, cream, smoothstep(...PALE, luminanceOf(base)).mul(TIP_PALENESS));
}

/**
 * What paints one fragment of a Leaf Mass card, all fixed per point of the tree (an Impostor bakes them):
 * see `leafMassPaint`.
 */
export interface LeafMassPaint {
  /** The card's lighting normal: its normal bent towards its mass's (`aMass`), in tree space (both sides lit as the mass). */
  normal: Node;
  /**
   * Where on the crown gradient the fragment sits before light (about -1..1, the gradient is 0..1): high and
   * on the sunlit tips is warm, buried and underneath is deep; the spray texture's paint value moves it.
   */
  shade: Node;
  /** The mass's random number (0..1): its per-mass tint and lightness. */
  mass: Node;
  /** Multiplier (0.6..1): the gaps between painted leaves a little darker. */
  gap: Node;
}

/**
 * The paint of a Leaf Mass card at this fragment, from `aMass`, `aPaint` (see {@link LeafMassPoint}), the
 * lighting normal's up-ness and the spray texture `spray` (its grey is a paint value 0..1, its alpha the
 * coverage), if any. The weights are {@link SHADE}; `paintLeafColor` is its CPU twin.
 */
export function leafMassPaint(spray: Node | null): LeafMassPaint {
  const value = spray ? spray.r : float(0.5);
  const coverage = spray ? spray.a : float(1);
  const normal = mix(normalGeometry, attribute('aMass', 'vec3'), BEND).normalize();
  const paint = attribute('aPaint', 'vec4');
  const [height, buried, tipLight, mass] = [paint.x, paint.y, paint.z, paint.w];
  const up = normal.y.mul(0.5).add(0.5);
  const shade = float(SHADE.offset)
    .add(height.mul(SHADE.height))
    .add(up.mul(SHADE.up))
    .add(tipLight.sub(0.5).mul(SHADE.tipLight))
    .sub(buried.mul(SHADE.buried))
    .add(value.sub(0.5).mul(SHADE.spray * SPRAY_STRENGTH));
  const gap = mix(float(1), float(GAP_DARK), float(1).sub(coverage).mul(SPRAY_STRENGTH));
  return { normal, shade, mass, gap };
}

/**
 * The crown gradient: the Season colour `base` painted at `paint.shade` (see `LeafMassPaint`) moved up by
 * `lit` (0..1, as direct light does). Deep, cool green inside and under the masses, the leaf colour in the
 * middle, warm sunlit tips; built relative to `base`, so it follows the Season.
 */
export function paintGradient(base: Node, lit: Node, paint: Omit<LeafMassPaint, 'normal'>): Node {
  // Light colours (fresh spring green, blossom) keep a lighter, less blue inside.
  const pale = smoothstep(...PALE, luminanceOf(base));
  const deep = mix(base.mul(mix(vec3(...DEEP), vec3(...DEEP_PALE), pale)), color(DEEP_COLOR), mix(DEEP_TOWARDS.dark, DEEP_TOWARDS.pale, pale));
  const mid = base.mul(MID_GAIN);
  const tip = paintedTip(base);
  const t = (paint.shade as Node).add(lit).clamp(0, 1);
  const ramp = mix(mix(deep, mid, smoothstep(...TO_MID, t)), tip, smoothstep(...TO_TIP, t));
  // A little per-mass variation (lighter or darker, warmer or cooler); the gaps between painted leaves a little darker.
  const mass = paint.mass as Node;
  const massTint = mix(vec3(...MASS_WARMER), vec3(...MASS_COOLER), mass);
  return ramp.mul(massTint).mul(mass.sub(0.5).mul(MASS_LIGHTNESS).add(1)).mul(paint.gap);
}

/** Softens a received shadow on painted leaves to `LEAF_SHADOW` (by `amount` 0..1 where only part is leaf, as on an Impostor). */
export function softenLeafShadows(material: MeshStandardNodeMaterial, amount: Node = float(1)): void {
  // @types/three declares it without its (shadow) argument.
  material.receivedShadowNode = ((shadow: Node) => mix(float(1), shadow, mix(float(1), float(LEAF_SHADOW), amount))) as unknown as () => Node;
}

/**
 * Makes a painted leaf material paint a Leaf Mass crown (leaf shape 'mass'): its normal bends from the
 * card's own towards its mass's, and its colour is painted on the crown gradient (`leafMassPaint`,
 * `paintGradient`). The spray texture already in `colorNode` (`applyLeafMap`), if any, is a paint value,
 * not a colour, so the colour becomes white with the texture's alpha (the cut-out) and the Season colour
 * multiplied in later is what gets painted.
 *
 * `toObject` turns a tree-space normal into the mesh's own space (a Forest rotates it by each instance);
 * default: tree space is object space.
 */
export function paintLeafMasses(material: PaintedNodeMaterial, toObject: (normal: Node) => Node = (normal) => normal): void {
  const spray = material.colorNode as Node | null;
  if (spray) material.colorNode = vec4(1, 1, 1, spray.a);
  softenLeafShadows(material);
  const massPaint = leafMassPaint(spray);
  material.massPaint = massPaint;
  material.normalNode = transformNormalToView(toObject(massPaint.normal)).normalize();
  material.paint = (base, lit) => paintGradient(base, lit, massPaint);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const luminance = (c: ArrayLike<number>): number => LUMINANCE[0] * c[0]! + LUMINANCE[1] * c[1]! + LUMINANCE[2] * c[2]!;
const DEEP_LINEAR = hexToLinear(DEEP_COLOR);

/** A Leaf Mass vertex's `aPaint` (see `massLeafGeometry`), by name. */
export interface LeafMassPoint {
  /** Height in the crown, 0 (bottom) .. 1 (top). */
  height: number;
  /** How buried, 0 (open) .. 1 (hidden). */
  buried: number;
  /** Tip light, 0 (deep in the mass) .. 1 (a card tip on the shell). */
  tipLight: number;
  /** The mass's random number, 0..1. */
  mass: number;
}

/** Vertex `v` of an `aPaint` array (itemSize 4) as a {@link LeafMassPoint}. */
export function leafMassPoint(aPaint: ArrayLike<number>, v: number): LeafMassPoint {
  return { height: aPaint[v * 4]!, buried: aPaint[v * 4 + 1]!, tipLight: aPaint[v * 4 + 2]!, mass: aPaint[v * 4 + 3]! };
}

/** The wrap lighting of the painted shading on the CPU: how lit (0..1) a surface is at `nDotL` (N·L). */
export function wrapLight(nDotL: number): number {
  return smoothstepNumber(0, 1, (nDotL + WRAP) / (1 + WRAP));
}

/** A Leaf Mass card's lighting normal on the CPU, as the material's normalNode: normalize(mix(card normal, mass normal, BEND)). */
export function bendToMass(card: ArrayLike<number>, mass: ArrayLike<number>): [number, number, number] {
  const b = [0, 1, 2].map((c) => card[c]! * (1 - BEND) + mass[c]! * BEND);
  const length = hypot3(b[0]!, b[1]!, b[2]!) || 1;
  return [b[0]! / length, b[1]! / length, b[2]! / length];
}

/**
 * The leaf paint of {@link paintLeafMasses} on the CPU, for the Baked Tree (#120): the painted colour of a Leaf
 * Mass vertex from its unpainted colour `base` (linear rgb), its `aPaint` (`point`), the y of its lighting normal,
 * the spray's paint `value` and `coverage`, and `lit` (0 = no direct light, the material's diffuse colour). The
 * same ramp as `leafMassPaint`, `paintGradient` and `paintedTip`, from the same constants.
 */
export function paintLeafColor(
  base: ArrayLike<number>,
  point: LeafMassPoint,
  normalY: number,
  { value = 0.5, coverage = 1, lit = 0 }: { value?: number; coverage?: number; lit?: number } = {},
): [number, number, number] {
  const up = normalY * 0.5 + 0.5;
  const shade =
    SHADE.offset + point.height * SHADE.height + up * SHADE.up + (point.tipLight - 0.5) * SHADE.tipLight - point.buried * SHADE.buried + (value - 0.5) * SHADE.spray * SPRAY_STRENGTH;
  const t = Math.min(Math.max(shade + lit, 0), 1);
  const [toMid, toTip] = [smoothstepNumber(...TO_MID, t), smoothstepNumber(...TO_TIP, t)];
  const pale = smoothstepNumber(...PALE, luminance(base));
  // paintedTip
  const sunlit = [0, 1, 2].map((c) => base[c]! * TIP_GAIN + TIP_SUN[c]!);
  const cream = Math.max(luminance(sunlit), 0.5);
  const toCream = pale * TIP_PALENESS;
  const gap = lerp(1, GAP_DARK, (1 - coverage) * SPRAY_STRENGTH);
  const lightness = (1 + (point.mass - 0.5) * MASS_LIGHTNESS) * gap;
  return [0, 1, 2].map((c) => {
    const deep = lerp(base[c]! * lerp(DEEP[c]!, DEEP_PALE[c]!, pale), DEEP_LINEAR[c]!, lerp(DEEP_TOWARDS.dark, DEEP_TOWARDS.pale, pale));
    const mid = base[c]! * MID_GAIN;
    const tip = lerp(sunlit[c]!, TIP_PALE[c]! * cream, toCream);
    const ramp = lerp(lerp(deep, mid, toMid), tip, toTip);
    return ramp * lerp(MASS_WARMER[c]!, MASS_COOLER[c]!, point.mass) * lightness;
  }) as [number, number, number];
}
