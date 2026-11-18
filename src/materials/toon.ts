import {
  LightingModel,
  MeshStandardNodeMaterial,
  type LightingModelDirectInput,
  type NodeBuilder,
  type PhysicalLightingModel,
} from 'three/webgpu';
import { BRDF_Lambert, diffuseColor, float, mix, normalView, smoothstep } from 'three/tsl';
import { translucencyDirect, translucencyIndirect, type LeafTranslucencyTerm } from './leaf-translucency';

// TSL node types are loosely typed in @types/three; keep our own alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/** Brightness of the shaded side, relative to the lit side (the toon "shadow tone"). */
const SHADE = 0.5;
/** The soft band between shade and light, in N·L (a hard toon edge would be 0 wide). */
const BAND_START = 0;
const BAND_END = 0.2;

/**
 * Soft toon lighting: two tones (lit and shaded) per light with a smooth band in between,
 * plus plain diffuse ambient/hemisphere light. No specular or environment reflections. Built
 * in TSL from the light direction only, so it needs no gradient texture (no image files).
 *
 * With a Leaf Translucency term (leaf material only, `applyLeafTranslucency`), leaves with light behind them also glow:
 * the same shared term the physical leaf model adds.
 */
export class SoftToonLightingModel extends LightingModel {
  constructor(private readonly translucency: LeafTranslucencyTerm | null = null) {
    super();
  }

  /** Whether this model adds Leaf Translucency. */
  get isLeafTranslucencyModel(): boolean {
    return this.translucency !== null;
  }

  override direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput): void {
    const dotNL: Node = normalView.dot(lightDirection as Node);
    const tone = mix(float(SHADE), float(1), smoothstep(BAND_START, BAND_END, dotNL));
    const irradiance = (lightColor as Node).mul(tone);
    (reflectedLight.directDiffuse as Node).addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
    if (this.translucency) (reflectedLight.directDiffuse as Node).addAssign(translucencyDirect(this.translucency, lightDirection, lightColor));
  }

  override indirect(builder: NodeBuilder): void {
    const { ambientOcclusion, irradiance, reflectedLight } = (builder as Node).context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
    if (this.translucency) reflectedLight.indirectDiffuse.addAssign(translucencyIndirect(this.translucency, builder));
  }
}

/**
 * The stylized Style's material (`materials.shading: 'toon'`): a `MeshStandardNodeMaterial`
 * lit by the soft toon model. Staying a standard material keeps every part node (Season
 * colour, Growth/Wind `positionNode`) and exporters (they see a plain PBR material) working
 * the same as for the other Styles.
 */
export class SoftToonNodeMaterial extends MeshStandardNodeMaterial {
  readonly isSoftToonMaterial = true;

  override setupLightingModel(): PhysicalLightingModel {
    // The declared return type is the physical model; the renderer only uses the LightingModel interface.
    return new SoftToonLightingModel() as unknown as PhysicalLightingModel;
  }
}
