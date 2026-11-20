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
/** Contrast of the painted gradient around its middle (1 = as painted, 0 = flat). */
const GRADIENT = 1;
/** How much the spray texture's paint value moves the gradient (and darkens the gaps between leaves). */
export const TEXTURE = 0.6;
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
  /** The leaf gradient, or null (bark, Fruit, Impostors): the colour as it is, warmed by direct light. */
  paint: LeafPaint | null = null;
  /** Leaf Translucency (a Material Feature), or null. */
  translucency: LeafTranslucencyTerm | null = null;

  override setupDiffuseColor(builder: NodeBuilder): void {
    super.setupDiffuseColor(builder);
    (paintBase as Node).assign(diffuseColor.rgb);
    if (this.paint) (diffuseColor as Node).assign(vec4(this.paint(paintBase, float(0)), diffuseColor.a));
  }

  override setupLightingModel(): PhysicalLightingModel {
    // The declared return type is the physical model; the renderer only uses the LightingModel interface.
    return new PaintedLightingModel(this.paint, this.translucency) as unknown as PhysicalLightingModel;
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
  ) {
    super();
  }

  /** Whether this model adds Leaf Translucency. */
  get isLeafTranslucencyModel(): boolean {
    return this.translucency !== null;
  }

  override direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput): void {
    const wrapped = normalView.dot(lightDirection as Node).add(WRAP).div(1 + WRAP);
    const soft = smoothstep(0, 1, wrapped);
    const lit = this.paint ? this.paint(paintBase, soft.mul(SUNLIT)) : mix(diffuseColor.rgb, diffuseColor.rgb.mul(vec3(...WARM)), soft);
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

const luminanceOf = (c: Node): Node => c.dot(vec3(0.2126, 0.7152, 0.0722));

/** The warm, sunlit tip colour of the leaf gradient for the (linear) leaf colour `base`: see {@link TIP_GAIN}. */
function paintedTip(base: Node): Node {
  const sunlit = base.mul(TIP_GAIN).add(vec3(...TIP_SUN));
  const cream = vec3(...TIP_PALE).mul(luminanceOf(sunlit).max(0.5));
  return mix(sunlit, cream, smoothstep(0.2, 0.6, luminanceOf(base)).mul(TIP_PALENESS));
}

/**
 * Makes a painted leaf material paint a Leaf Mass crown (leaf shape 'mass'): its normal bends from the
 * card's own towards its mass's (`aMass`, no back-face flip: both sides lit as the mass), and its colour is
 * painted from `aPaint` (height in the crown, how buried, tip light, per-mass random), the bent normal's
 * up-ness and the spray texture already in `colorNode` (`applyLeafMap`), if any: its grey is a paint value
 * (0..1), not a colour, so the colour becomes white with the texture's alpha (the cut-out) and the Season
 * colour multiplied in later is what gets painted.
 */
export function paintLeafMasses(material: PaintedNodeMaterial): void {
  const spray = material.colorNode as Node | null;
  const value = spray ? spray.r : float(0.5);
  const coverage = spray ? spray.a : float(1);
  if (spray) material.colorNode = vec4(1, 1, 1, coverage);
  // @types/three declares it without its (shadow) argument.
  material.receivedShadowNode = ((shadow: Node) => mix(float(1), shadow, LEAF_SHADOW)) as unknown as () => Node;
  const bent = mix(normalGeometry, attribute('aMass', 'vec3'), BEND).normalize();
  material.normalNode = transformNormalToView(bent).normalize();
  const paint = attribute('aPaint', 'vec4');
  const up = bent.y.mul(0.5).add(0.5);
  material.paint = (base, lit) => {
    // Light colours (fresh spring green, blossom) keep a lighter, less blue inside.
    const pale = smoothstep(0.2, 0.6, luminanceOf(base));
    const deep = mix(base.mul(mix(vec3(...DEEP), vec3(...DEEP_PALE), pale)), color(DEEP_COLOR), mix(0.35, 0.15, pale));
    const mid = base.mul(1.12);
    const tip = paintedTip(base);
    const t = float(-0.06)
      .add(paint.x.mul(0.2))
      .add(up.mul(0.34))
      .add(paint.z.sub(0.5).mul(0.25))
      .sub(paint.y.mul(0.6))
      .add(value.sub(0.5).mul(0.9 * TEXTURE))
      .add(lit)
      .sub(0.5)
      .mul(GRADIENT)
      .add(0.5)
      .clamp(0, 1);
    const ramp = mix(mix(deep, mid, smoothstep(0, 0.55, t)), tip, smoothstep(0.5, 1, t));
    // A little per-mass variation (lighter or darker, warmer or cooler); the gaps between painted leaves a little darker.
    const massTint = mix(vec3(...MASS_WARMER), vec3(...MASS_COOLER), paint.w);
    return ramp.mul(massTint).mul(paint.w.sub(0.5).mul(0.12).add(1)).mul(mix(float(1), float(0.6), float(1).sub(coverage).mul(TEXTURE)));
  };
}

const smooth = (low: number, high: number, x: number): number => {
  const t = Math.min(Math.max((x - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const luminance = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const DEEP_LINEAR = hexToLinear(DEEP_COLOR);

/**
 * The leaf paint of {@link paintLeafMasses} on the CPU, for the Baked Tree (#120): the painted colour of a Leaf
 * Mass vertex from its unpainted colour `base` (linear rgb), its `aPaint`, the y of its bent normal, the spray's
 * paint value and coverage, and `lit` (0 = no direct light, the material's diffuse colour). Keep it in step with
 * the TSL `paint` above and `paintedTip` (the same ramp, number for number).
 */
export function paintLeafColor(
  base: readonly number[],
  paint: readonly number[],
  normalY: number,
  value = 0.5,
  coverage = 1,
  lit = 0,
): [number, number, number] {
  const up = normalY * 0.5 + 0.5;
  const raw = -0.06 + paint[0]! * 0.2 + up * 0.34 + (paint[2]! - 0.5) * 0.25 - paint[1]! * 0.6 + (value - 0.5) * 0.9 * TEXTURE + lit;
  const t = Math.min(Math.max((raw - 0.5) * GRADIENT + 0.5, 0), 1);
  const [toMid, toTip] = [smooth(0, 0.55, t), smooth(0.5, 1, t)];
  const pale = smooth(0.2, 0.6, luminance(base));
  // paintedTip
  const sunlit = [0, 1, 2].map((c) => base[c]! * TIP_GAIN + TIP_SUN[c]!);
  const cream = Math.max(luminance(sunlit), 0.5);
  const toCream = smooth(0.2, 0.6, luminance(base)) * TIP_PALENESS;
  const shade = (1 + (paint[3]! - 0.5) * 0.12) * lerp(1, 0.6, (1 - coverage) * TEXTURE);
  return [0, 1, 2].map((c) => {
    const deep = lerp(base[c]! * lerp(DEEP[c]!, DEEP_PALE[c]!, pale), DEEP_LINEAR[c]!, lerp(0.35, 0.15, pale));
    const mid = base[c]! * 1.12;
    const tip = lerp(sunlit[c]!, TIP_PALE[c]! * cream, toCream);
    const ramp = lerp(lerp(deep, mid, toMid), tip, toTip);
    return ramp * lerp(MASS_WARMER[c]!, MASS_COOLER[c]!, paint[3]!) * shade;
  }) as [number, number, number];
}
