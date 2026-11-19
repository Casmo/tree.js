import { Color, type ColorRepresentation, type Node, type UniformNode } from 'three/webgpu';
import { cameraPosition, float, hash, smoothstep, step, uniform } from 'three/tsl';
import type { TreePart } from '../effects/mask';
import {
  readyMadeShaderHook,
  type TreeShaderHook,
  type TreeShaderHooks,
  type TreeShaderInput,
  type TreeShaderOutput,
} from '../materials/shader-hooks';

export interface SnowOptions {
  /** How much snow lies on the trees: 0 = none (default), 1 = full cover. */
  amount?: number;
}

/**
 * A snow amount (0..1) that every {@link SnowCover} following it whitens trees by, like a `Wind` is shared
 * by the trees swaying with it. Changing it only writes a uniform (no recompile). Snow Cover follows
 * {@link sceneSnow} unless it is given another one.
 */
export class Snow {
  /** The shared TSL uniform Snow Cover reads. Write through the setters, not here. */
  readonly uniforms: { readonly amount: UniformNode<'float', number> };

  constructor(options: SnowOptions = {}) {
    this.uniforms = { amount: uniform(0) };
    this.set(options);
  }

  get amount(): number {
    return this.uniforms.amount.value;
  }

  set amount(value: number) {
    if (!(value >= 0 && value <= 1)) throw new RangeError(`Snow amount must be a number from 0 to 1, got ${value}`);
    this.uniforms.amount.value = value;
  }

  /** Sets the amount; returns this. */
  set(options: SnowOptions): this {
    if (options.amount !== undefined) this.amount = options.amount;
    return this;
  }
}

/** The scene-wide snow amount every Snow Cover follows by default. */
export const sceneSnow = new Snow();

/** How much snow each tree part takes (0..1 each; 1 = all the snow there is). */
export type SnowStrength = Record<TreePart, number>;

export interface SnowCoverOptions {
  /** The snow amount it follows. Default: the scene-wide {@link sceneSnow}. */
  snow?: Snow;
  /** Snow colour (sRGB, like any three.js colour). Default `#f4f8ff`, a slightly blue white. */
  color?: ColorRepresentation;
  /** The steepest surface that still holds snow, in degrees from level ground (0..90). Default 60. */
  slope?: number;
  /** How soft the snow's edge is (0..1): 0 a hard line at `slope`, 1 fading in from `slope` to level. Default 0.35. */
  softness?: number;
  /** How much snow each tree part takes (0..1; parts left out keep theirs). Default 1 for bark, leaves and fruit. */
  strength?: Partial<SnowStrength>;
}

const SNOW_ROUGHNESS = 0.75;

/**
 * Snow Cover (GLOSSARY, ADR 0012): a ready-made Tree Shader Hook that whitens the upward-facing surfaces
 * of trees by a snow amount ({@link sceneSnow} unless given another {@link Snow}), drawn to suit the
 * tree's Style: hard flat caps in low-poly, toon bands in stylized, lit snow with a slight sparkle in
 * realistic. It is a set of hooks (`bark`, `leaves`, `fruit`), so it is set like any hooks:
 * `tree.shaderHooks = snowCover`, `forest.shaderHooks = ...` or `setSceneShaderHooks(snowCover)`, and
 * stacks with others (`stackShaderHooks`); it runs before the app's own hooks. Its settings are uniforms:
 * changing them never rebuilds a node graph. With the amount at 0 the trees look exactly as without it.
 *
 * Snow is read from the world normal after Wind, so it follows swaying branches and lies on bare winter
 * branches when the leaves are gone. A game that wants its own snow can copy {@link snowCoverShading}.
 */
export class SnowCover implements TreeShaderHooks {
  /** The snow amount it follows. */
  readonly snow: Snow;
  /** The shared TSL uniforms its hooks read. Write through the setters, not here. */
  readonly uniforms: {
    readonly color: UniformNode<'color', Color>;
    /** The cosine of `slope`: the least upward a surface may face and hold snow. */
    readonly minUp: UniformNode<'float', number>;
    readonly softness: UniformNode<'float', number>;
    readonly strength: Readonly<Record<TreePart, UniformNode<'float', number>>>;
  };
  readonly bark: TreeShaderHook;
  readonly leaves: TreeShaderHook;
  readonly fruit: TreeShaderHook;
  private degrees = 60;

  constructor(options: SnowCoverOptions = {}) {
    this.snow = options.snow ?? sceneSnow;
    this.uniforms = {
      color: uniform(new Color('#f4f8ff')),
      minUp: uniform(0.5),
      softness: uniform(0.35),
      strength: { bark: uniform(1), leaves: uniform(1), fruit: uniform(1) },
    };
    this.set(options);
    // One hook for every part (it reads the part from its input), marked ready-made so it runs first.
    const hook = readyMadeShaderHook((input: TreeShaderInput) =>
      snowCoverShading(input, {
        amount: this.snow.uniforms.amount.mul(this.uniforms.strength[input.part]),
        color: this.uniforms.color as unknown as Node<'vec3'>,
        minUp: this.uniforms.minUp,
        softness: this.uniforms.softness,
      }),
    );
    this.bark = this.leaves = this.fruit = hook;
  }

  /** Snow colour (a copy: assign a new value to change it). */
  get color(): Color {
    return this.uniforms.color.value.clone();
  }

  set color(value: ColorRepresentation) {
    this.uniforms.color.value.set(value);
  }

  /** The steepest surface that still holds snow, in degrees from level ground (0..90). */
  get slope(): number {
    return this.degrees;
  }

  set slope(value: number) {
    if (!(value >= 0 && value <= 90)) throw new RangeError(`Snow Cover slope must be 0..90 degrees, got ${value}`);
    this.degrees = value;
    this.uniforms.minUp.value = Math.cos((value * Math.PI) / 180);
  }

  /** How soft the snow's edge is (0..1). */
  get softness(): number {
    return this.uniforms.softness.value;
  }

  set softness(value: number) {
    if (!(value >= 0 && value <= 1)) throw new RangeError(`Snow Cover softness must be 0..1, got ${value}`);
    this.uniforms.softness.value = value;
  }

  /** How much snow each tree part takes (a copy). Assigning sets the parts given, the others keep theirs. */
  get strength(): SnowStrength {
    const { bark, leaves, fruit } = this.uniforms.strength;
    return { bark: bark.value, leaves: leaves.value, fruit: fruit.value };
  }

  set strength(value: Partial<SnowStrength>) {
    for (const part of ['bark', 'leaves', 'fruit'] as const) {
      const strength = value[part];
      if (strength === undefined) continue;
      if (!(strength >= 0 && strength <= 1)) throw new RangeError(`Snow Cover ${part} strength must be 0..1, got ${strength}`);
      this.uniforms.strength[part].value = strength;
    }
  }

  /** Sets any of the settings (not `snow`); returns this. */
  set(options: Omit<SnowCoverOptions, 'snow'>): this {
    if (options.color !== undefined) this.color = options.color;
    if (options.slope !== undefined) this.slope = options.slope;
    if (options.softness !== undefined) this.softness = options.softness;
    if (options.strength !== undefined) this.strength = options.strength;
    return this;
  }
}

/** The settings {@link snowCoverShading} draws with, as TSL nodes (uniforms, so they can change live). */
export interface SnowCoverShadingSettings {
  /** How much snow (0..1): the snow amount times the part's strength. */
  amount: Node<'float'>;
  /** Snow colour (linear rgb). */
  color: Node<'vec3'>;
  /** The least upward (world normal y) a surface may face and still hold snow: the cosine of the slope. */
  minUp: Node<'float'>;
  /** Edge softness (0..1). */
  softness: Node<'float'>;
}

/**
 * The shading of Snow Cover, as a plain Tree Shader Hook body: a starting point for a game's own snow.
 * It only uses the hook's inputs and the settings given.
 */
export function snowCoverShading(input: TreeShaderInput, settings: SnowCoverShadingSettings): TreeShaderOutput {
  const { shading, color, roughness, position } = input;
  const { amount, minUp, softness } = settings;

  // How much a surface faces up: 1 on level ground, `minUp` at the steepest slope that holds snow, below
  // that (steeper, or facing down) none. The normal is the one lit, after Wind: snow sways with the branch.
  const up = input.normal.normalize().y;
  const edge = softness.mul(float(1).sub(minUp)).max(1e-3);
  const lies = smoothstep(minUp, minUp.add(edge), up);

  let cover: Node<'float'>;
  let snow: Node<'vec3'> = settings.color;
  if (shading === 'flat') {
    // Low-poly: flat caps. A facet holds snow or not (its normal is the facet's), no soft edge on it.
    cover = step(0.5, lies).mul(amount);
  } else if (shading === 'toon') {
    // Stylized: toon bands. The cover in three steps, so the edge reads as bands, like the toon light.
    cover = lies.mul(amount).mul(3).add(0.5).floor().div(3);
  } else {
    // Realistic: soft, lit snow with a slight sparkle: a few tiny cells glint, changing with the view.
    cover = lies.mul(amount);
    const view = cameraPosition.sub(position).normalize();
    const cell = position.mul(60).floor().add(view.mul(6).floor());
    const glint = step(0.985, hash(cell.x.add(cell.y.mul(57)).add(cell.z.mul(113))));
    snow = snow.mul(glint.mul(0.35).add(1));
  }

  // Exactly the colour and roughness given where `cover` is 0.
  return {
    color: color.add(snow.sub(color).mul(cover)),
    roughness: roughness.add(float(SNOW_ROUGHNESS).sub(roughness).mul(cover)),
  };
}
