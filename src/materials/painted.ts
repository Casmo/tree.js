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
import { translucencyDirect, translucencyIndirect, type LeafTranslucencyTerm } from './leaf-translucency';

// TSL node types are loosely typed in @types/three; keep our own alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

// The painted look (Painterly, ADR 0014), tuned on concept D "medium".
/** Wrap lighting: how far light reaches round the shaded side, in N·L (0 = Lambert, 1 = half-Lambert). */
const WRAP = 0.5;
/** How far a Leaf Mass card's normal bends from the card's own towards its mass's (`aMass`), 0..1. */
const BEND = 0.85;
/** Contrast of the painted gradient around its middle (1 = as painted, 0 = flat). */
const GRADIENT = 1;
/** How much the spray texture's paint value moves the gradient (and darkens the gaps between leaves). */
const TEXTURE = 0.6;
/** How far direct light moves a leaf up the gradient (towards the warm tips). */
const SUNLIT = 0.35;
/**
 * How much of a received shadow a Leaf Mass card shows: a little. Cards shadowing each other read as
 * speckles; the painted gradient already darkens the inside of the masses (concepts, ADR 0014).
 */
const LEAF_SHADOW = 0.3;
/** Direct light warms bark and Fruit a little (multiplier on the lit colour). */
const WARM = [1.06, 1.02, 0.9] as const;

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
    const wrapped = normalView.dot(lightDirection as Node).add(WRAP).div(1 + WRAP);
    const soft = smoothstep(0, 1, wrapped);
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

/**
 * What paints one fragment of a Leaf Mass card, all fixed per point of the tree (an Impostor bakes them):
 * see `leafMassPaint`.
 */
export interface LeafMassPaint {
  /** The card's normal bent towards its mass's (`aMass`), in tree space (both sides lit as the mass). */
  normal: Node;
  /**
   * Where on the crown gradient the fragment sits before light (about -1..1, the gradient is 0..1): high and
   * on the sunlit tips is warm, buried and underneath is deep; the spray texture's paint value moves it.
   */
  shade: Node;
  /** Multiplier on the painted colour: a little per-mass variation, the gaps between painted leaves darker. */
  tone: Node;
}

/**
 * The paint of a Leaf Mass card at this fragment, from `aMass`, `aPaint` (height in the crown, how buried,
 * tip light, per-mass random), the bent normal's up-ness and the spray texture `spray` (its grey is a
 * paint value 0..1, its alpha the coverage), if any.
 */
export function leafMassPaint(spray: Node | null): LeafMassPaint {
  const value = spray ? spray.r : float(0.5);
  const coverage = spray ? spray.a : float(1);
  const normal = mix(normalGeometry, attribute('aMass', 'vec3'), BEND).normalize();
  const paint = attribute('aPaint', 'vec4');
  const up = normal.y.mul(0.5).add(0.5);
  const shade = float(-0.06)
    .add(paint.x.mul(0.2))
    .add(up.mul(0.34))
    .add(paint.z.sub(0.5).mul(0.25))
    .sub(paint.y.mul(0.6))
    .add(value.sub(0.5).mul(0.9 * TEXTURE));
  // A little per-mass variation; the gaps between painted leaves a little darker.
  const tone = paint.w.sub(0.5).mul(0.12).add(1).mul(mix(float(1), float(0.6), float(1).sub(coverage).mul(TEXTURE)));
  return { normal, shade, tone };
}

/**
 * The crown gradient: the Season colour `base` painted at `shade` (see `LeafMassPaint`) moved up by `lit`
 * (0..1, as direct light does), times `tone`. Deep, cool green inside and under the masses, the leaf colour
 * in the middle, warm yellow-green on the tips and tops; built relative to `base`, so it follows the Season.
 */
export function paintGradient(base: Node, shade: Node, lit: Node, tone: Node): Node {
  const deep = mix(base.mul(vec3(0.22, 0.32, 0.45)), color('#0b2427'), 0.35);
  const mid = base.mul(1.12);
  const tip = mix(base, color('#bcd24a'), 0.5).mul(1.1);
  const t = (shade as Node).add(lit).sub(0.5).mul(GRADIENT).add(0.5).clamp(0, 1);
  const ramp = mix(mix(deep, mid, smoothstep(0, 0.55, t)), tip, smoothstep(0.5, 1, t));
  return ramp.mul(tone);
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
  material.paint = (base, lit) => paintGradient(base, massPaint.shade, lit, massPaint.tone);
}
