import {
  LightingModel,
  MeshStandardNodeMaterial,
  type LightingModelDirectInput,
  type NodeBuilder,
  type PhysicalLightingModel,
} from 'three/webgpu';
import { BRDF_Lambert, color, diffuseColor, float, fract, mix, normalView, positionViewDirection, smoothstep, uv, vec3 } from 'three/tsl';
import type { TreeDefinition } from '../definition';
import { translucencyDirect, translucencyIndirect, type LeafTranslucencyTerm } from './leaf-translucency';

// TSL node types are loosely typed in @types/three; keep our own alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/** The three toon tones (shade, mid, lit), relative to the full light. The shade stays bright: no muddy shadows. */
const TONES = [0.62, 0.84, 1] as const;
/** Where (in N·L) each band starts, and how wide its edge is (crisp, just wide enough not to alias). */
const BANDS = [0, 0.45] as const;
const EDGE = 0.03;
/** The shade is tinted a cool lavender rather than greyed, so shaded candy colours stay clean. */
const SHADE_TINT = [0.9, 0.86, 1] as const;
/** The rim light: on silhouettes (1 - N·V above this), coloured from the surface towards a warm pink-white. */
const RIM_START = 0.55;
const RIM_END = 0.7;
const RIM_COLOR = [1, 0.86, 0.95] as const;
const RIM_STRENGTH = 0.35;

/**
 * Whimsical lighting: per light, three crisp toon tones (shade, mid, lit) with a cool tinted shade, plus a
 * coloured rim light on the silhouette; plain diffuse ambient and hemisphere light. No specular or
 * environment reflections, no textures. With a Leaf Translucency term, lit-from-behind leaves glow too.
 */
export class WhimsicalLightingModel extends LightingModel {
  constructor(private readonly translucency: LeafTranslucencyTerm | null = null) {
    super();
  }

  /** Whether this model adds Leaf Translucency. */
  get isLeafTranslucencyModel(): boolean {
    return this.translucency !== null;
  }

  override direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput): void {
    const dotNL: Node = normalView.dot(lightDirection as Node);
    const mid = mix(vec3(...SHADE_TINT).mul(TONES[0]), vec3(TONES[1]), smoothstep(BANDS[0] - EDGE, BANDS[0] + EDGE, dotNL));
    const tone = mix(mid, vec3(TONES[2]), smoothstep(BANDS[1] - EDGE, BANDS[1] + EDGE, dotNL));
    const direct = reflectedLight.directDiffuse as Node;
    direct.addAssign((lightColor as Node).mul(tone).mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
    const edge = float(1).sub(normalView.dot(positionViewDirection).abs());
    const rim = smoothstep(RIM_START, RIM_END, edge).mul(RIM_STRENGTH);
    direct.addAssign((lightColor as Node).mul(rim).mul(mix(diffuseColor.rgb, vec3(...RIM_COLOR), 0.5)));
    if (this.translucency) direct.addAssign(translucencyDirect(this.translucency, lightDirection as Node, lightColor as Node));
  }

  override indirect(builder: NodeBuilder): void {
    const { ambientOcclusion, irradiance, reflectedLight } = (builder as Node).context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
    if (this.translucency) reflectedLight.indirectDiffuse.addAssign(translucencyIndirect(this.translucency, builder));
  }
}

/**
 * The whimsical Style's material (`materials.shading: 'whimsical'`): a `MeshStandardNodeMaterial` lit by
 * the whimsical model, so every part node (Season colour, Growth/Wind `positionNode`, Shader Hooks) and the
 * exporters work as for the other Styles.
 */
export class WhimsicalNodeMaterial extends MeshStandardNodeMaterial {
  readonly isWhimsicalMaterial = true;

  override setupLightingModel(): PhysicalLightingModel {
    // The declared return type is the physical model; the renderer only uses the LightingModel interface.
    return new WhimsicalLightingModel() as unknown as PhysicalLightingModel;
  }
}

/** Candy stripes round each branch, and how many extra turns they wind along it on top of the Corkscrew's roll. */
const STRIPES = 2;
const STRIPE_TURNS = 1;
/** Share of each stripe period in the accent colour. */
const STRIPE_WIDTH = 0.4;
const STRIPE_EDGE = 0.04;

/**
 * The tree's accent colour: its Leaf Palette's (from the per-tree Definition, `definitionForSeed`), or
 * without Leaf Palettes its first leaf colour.
 */
export const accentOf = (definition: TreeDefinition): string =>
  definition.season.leafPalettes?.[0]?.accent ?? definition.season.leafColor[0]!.value;

/**
 * The `whimsical` bark colour: `base` with candy stripes in the tree's accent colour. The bark's `uv.x`
 * goes round the branch in its frame, which a Corkscrew rolls (ADR 0016), so the stripes wind with it.
 */
export function candyStripes(base: Node, definition: TreeDefinition): Node {
  const along = fract(uv().x.add(uv().y.mul(STRIPE_TURNS)).mul(STRIPES));
  const stripe = smoothstep(0, STRIPE_EDGE, along).mul(float(1).sub(smoothstep(STRIPE_WIDTH, STRIPE_WIDTH + STRIPE_EDGE, along)));
  return mix(base, color(accentOf(definition)), stripe);
}
