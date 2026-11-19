import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { cameraPosition, float, hash, smoothstep, step, uniform } from 'three/tsl';
import { TREE_PARTS, type TreePart } from '../effects/mask';
import { readyMadeShaderHook, type TreeShaderHook, type TreeShaderInput, type TreeShaderOutput } from '../materials/shader-hooks';
import { degreesValue, slopeRange, softnessValue, strengthsWith, WeatherAmount } from './shared';

export interface SnowOptions {
  /** How much snow lies on the trees: 0 = none (default), 1 = full cover. */
  amount?: number;
}

/**
 * A snow amount (0..1) that every {@link snowCoverHooks} hook following it whitens trees by, like a `Wind`
 * is shared by the trees swaying with it. Changing it only writes a uniform (no recompile). Snow Cover
 * follows {@link sceneSnow} unless it is given another one.
 */
export class Snow extends WeatherAmount {
  constructor(options: SnowOptions = {}) {
    super('Snow amount', options);
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
   * normal is from facing straight up), as Wetness's `slope`. Default 60.
   */
  slope?: number;
  /**
   * Degrees (>= 0) below `slope` over which the snow fades out towards it: full up to `slope - softness`,
   * none from `slope` on, as Wetness's `softness`. Default 25; 0 is a hard edge.
   */
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
      const slope = next.slope === undefined ? look.slope : degreesValue('Snow Cover slope', next.slope, 90);
      const softness = next.softness === undefined ? look.softness : softnessValue('Snow Cover softness', next.softness);
      const strength = strengthsWith('Snow Cover', look.strength, next.strength);
      if (next.color !== undefined) look.color.set(next.color);
      Object.assign(look, { slope, softness, strength });
      u.color.value.copy(look.color);
      const range = slopeRange(look.slope, look.softness);
      u.bare.value = range.none;
      u.covered.value = range.full;
      for (const part of TREE_PARTS) u.strength[part].value = look.strength[part];
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
