import { Color, type ColorRepresentation, type Node, type UniformNode } from 'three/webgpu';
import { cameraPosition, float, hash, smoothstep, step, uniform } from 'three/tsl';
import type { TreePart } from '../effects/mask';
import { readyMadeShaderHook, type TreeShaderHook, type TreeShaderInput, type TreeShaderOutput } from '../materials/shader-hooks';

export interface SnowOptions {
  /** How much snow lies on the trees: 0 = none (default), 1 = full cover. */
  amount?: number;
}

/**
 * A snow amount (0..1) that every {@link snowCoverHooks} hook following it whitens trees by, like a `Wind`
 * is shared by the trees swaying with it. Changing it only writes a uniform (no recompile). Snow Cover
 * follows {@link sceneSnow} unless it is given another one.
 */
export class Snow {
  /** The shared TSL uniforms Snow Cover reads. Write through the setters, not here. */
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

/** How Snow Cover ({@link snowCoverHooks}) looks; every setting is live (a uniform write, no rebuild). */
export interface SnowCoverSettings {
  /** Snow colour (sRGB, like any three.js colour). Default `#f4f8ff`, a slightly blue white. */
  color?: ColorRepresentation;
  /**
   * The steepest surface that still holds snow, in degrees from level (0..90; the same as how far its
   * normal is from facing straight up). Default 60.
   */
  slope?: number;
  /** Degrees (>= 0) over which the snow fades out towards `slope`: below `slope - softness` it is full. Default 25; 0 is a hard edge. */
  softness?: number;
  /** How much snow each tree part takes (0..1). Default 1 for bark, leaves and fruit. */
  strength?: Partial<Record<TreePart, number>>;
}

/** The settings of a {@link snowCoverHooks} hook, all given. */
export interface SnowCoverLook {
  color: Color;
  slope: number;
  softness: number;
  strength: Record<TreePart, number>;
}

/**
 * The ready-made Snow Cover hooks (GLOSSARY: Snow Cover) for bark, leaves and fruit: a set of Tree Shader
 * Hooks to hand to a Tree, a Forest, `setSceneShaderHooks` or `stackShaderHooks`, with live settings.
 */
export interface SnowCoverHooks {
  readonly bark: TreeShaderHook;
  readonly leaves: TreeShaderHook;
  readonly fruit: TreeShaderHook;
  /** The snow amount the hooks follow. */
  readonly snow: Snow;
  /** The current settings (a copy). */
  readonly settings: SnowCoverLook;
  /** Changes settings live (uniform writes, no rebuild); returns this. */
  set(settings: SnowCoverSettings): this;
}

const DEFAULTS: SnowCoverLook = {
  color: new Color('#f4f8ff'),
  slope: 60,
  softness: 25,
  strength: { bark: 1, leaves: 1, fruit: 1 },
};

const PARTS = ['bark', 'leaves', 'fruit'] as const;

/** The cosine of an angle in degrees, clamped to 0..90. */
const cosOf = (degrees: number): number => Math.cos((Math.min(90, Math.max(0, degrees)) * Math.PI) / 180);

/**
 * Makes the ready-made Snow Cover hooks: they whiten the surfaces of trees that face up by the amount of
 * `snow` (default {@link sceneSnow}), drawn to suit the tree's Style: hard flat caps on `'flat'`
 * (low-poly), toon bands on `'toon'` (stylized), soft lit snow with a slight sparkle on `'standard'`
 * (realistic). Snow is read from the world normal after Wind, so it follows swaying branches and lies on
 * bare winter branches when the leaves are gone; undersides stay bare. With the amount at 0 the trees look
 * exactly as without the hooks. They run before the app's own hooks in every stack. A game that wants its
 * own snow can start from {@link snowCoverShading}.
 */
export function snowCoverHooks(settings: SnowCoverSettings & { snow?: Snow } = {}): SnowCoverHooks {
  const source = settings.snow ?? sceneSnow;
  const u = {
    color: uniform(DEFAULTS.color.clone()),
    // The normal's y at which a surface is bare (`slope`) and from which on it is fully covered.
    bare: uniform(0),
    covered: uniform(0),
    strength: { bark: uniform(0), leaves: uniform(0), fruit: uniform(0) },
  };
  const look: SnowCoverLook = { ...DEFAULTS, color: DEFAULTS.color.clone(), strength: { ...DEFAULTS.strength } };

  // One hook for every part (it reads the part from its input), marked ready-made so it runs first.
  const hook = readyMadeShaderHook((input: TreeShaderInput) =>
    snowCoverShading(input, {
      amount: source.uniforms.amount.mul(u.strength[input.part]),
      color: u.color as unknown as Node<'vec3'>,
      bare: u.bare,
      covered: u.covered,
    }),
  );

  const hooks: SnowCoverHooks = {
    bark: hook,
    leaves: hook,
    fruit: hook,
    snow: source,
    get settings() {
      return { ...look, color: look.color.clone(), strength: { ...look.strength } };
    },
    set(next: SnowCoverSettings) {
      // Checked in full before anything is written, so a bad value changes nothing.
      if (next.slope !== undefined && !(next.slope >= 0 && next.slope <= 90)) throw new RangeError(`Snow Cover slope must be 0..90 degrees, got ${next.slope}`);
      if (next.softness !== undefined && !(next.softness >= 0 && Number.isFinite(next.softness))) {
        throw new RangeError(`Snow Cover softness must be a finite number >= 0, got ${next.softness}`);
      }
      const strength = { ...look.strength };
      for (const part of PARTS) {
        const value = next.strength?.[part];
        if (value === undefined) continue;
        if (!(value >= 0 && value <= 1)) throw new RangeError(`Snow Cover ${part} strength must be a number in 0..1, got ${value}`);
        strength[part] = value;
      }
      if (next.color !== undefined) look.color.set(next.color);
      Object.assign(look, { slope: next.slope ?? look.slope, softness: next.softness ?? look.softness, strength });
      u.color.value.copy(look.color);
      u.bare.value = cosOf(look.slope);
      u.covered.value = Math.max(cosOf(look.slope - look.softness), u.bare.value + 1e-4);
      for (const part of PARTS) u.strength[part].value = look.strength[part];
      return this;
    },
  };
  return hooks.set(settings);
}

/** The settings {@link snowCoverShading} draws with, as TSL nodes (uniforms, so they can change live). */
export interface SnowCoverShadingSettings {
  /** How much snow (0..1): the snow amount times the part's strength. */
  amount: Node<'float'>;
  /** Snow colour (linear rgb). */
  color: Node<'vec3'>;
  /** The world normal's y at or below which a surface stays bare (the cosine of the steepest slope that holds snow). */
  bare: Node<'float'>;
  /** The world normal's y from which on a surface is fully covered (> `bare`). */
  covered: Node<'float'>;
}

const SNOW_ROUGHNESS = 0.75;

/**
 * The shading of Snow Cover, as a plain Tree Shader Hook body: a starting point for a game's own snow
 * (`const mySnow: TreeShaderHook = (input) => snowCoverShading(input, { ... })`). It only uses the hook's
 * inputs and the settings given.
 */
export function snowCoverShading(input: TreeShaderInput, settings: SnowCoverShadingSettings): TreeShaderOutput {
  const { shading, color, roughness, position } = input;
  const { amount, bare, covered } = settings;

  // How much a surface faces up, from bare (as steep as `slope`, or steeper, or facing down) to covered.
  // The normal is the one lit, after Wind: snow sways with the branch it lies on.
  const lies = smoothstep(bare, covered, input.normal.normalize().y);

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
