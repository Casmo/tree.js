import { dot, float, mix, smoothstep, step, uniform, vec3 } from 'three/tsl';
import { Color, type ColorRepresentation, type Node } from 'three/webgpu';
import { TREE_PARTS, type TreePart } from '../effects/mask';
import { readyMadeShaderHook, type TreeShaderHook, type TreeShaderInput } from '../materials/shader-hooks';
import { degreesValue, glints, paintStrokes, slopeRange, softnessValue, strengthsWith, unitValue, WeatherAmount } from './shared';

export interface WetnessOptions {
  /** How wet the trees are: 0 = dry (default), 1 = soaked. */
  amount?: number;
}

/**
 * A scene-wide wetness amount (0..1) that every {@link wetnessHooks} hook reading it follows, as after
 * rain. Shared like `sceneWind`: hooks use {@link sceneWetness} unless given another one. Changing it only
 * writes a uniform (no recompile).
 */
export class Wetness extends WeatherAmount {
  constructor(options: WetnessOptions = {}) {
    super('Wetness amount', options);
  }
}

/** The scene-wide wetness every Wetness hook follows by default. */
export const sceneWetness = new Wetness();

/** How a {@link wetnessHooks} hook looks; every setting is live (a uniform write, no rebuild). */
export interface WetnessSettings {
  /** The tint wet surfaces take on (multiplied into their colour). Default a cool grey, `#dfe6ee`. */
  color?: ColorRepresentation;
  /**
   * The steepest surface that still gets wet, in degrees from level (the same as how far its normal is
   * from facing straight up), as Snow Cover's `slope`, but up to 180 (facing straight down): sides and
   * undersides get wet too. Default 140 (only surfaces facing well down stay dry).
   */
  slope?: number;
  /**
   * Degrees (>= 0) below `slope` over which wetness fades out towards it: fully wet up to
   * `slope - softness`, dry from `slope` on, as Snow Cover's `softness`. Default 60; 0 is a hard edge.
   */
  softness?: number;
  /** How much each tree part takes (0..1). Default bark 1, leaves 0.8, fruit 0.5. */
  strength?: Partial<Record<TreePart, number>>;
  /** How much darker a soaked surface gets (0..1). Default 0.4. */
  darkening?: number;
  /** How much a soaked surface's roughness drops, so it shines (0..1). Default 0.6. */
  sheen?: number;
}

/** The settings of a {@link wetnessHooks} hook, all given. */
export interface WetnessLook {
  color: Color;
  slope: number;
  softness: number;
  strength: Record<TreePart, number>;
  darkening: number;
  sheen: number;
}

/**
 * The ready-made Wetness hooks (GLOSSARY: Wetness) for bark, leaves and fruit: a set of Tree Shader Hooks
 * to hand to a Tree, a Forest, `setSceneShaderHooks` or `stackShaderHooks`, with live settings.
 */
export interface WetnessHooks {
  readonly bark: TreeShaderHook;
  readonly leaves: TreeShaderHook;
  readonly fruit: TreeShaderHook;
  /** The amount the hooks follow. */
  readonly wetness: Wetness;
  /** The current settings (a copy). */
  readonly settings: WetnessLook;
  /** Changes settings live (uniform writes, no rebuild); returns this. */
  set(settings: WetnessSettings): this;
}

/** How much more saturated soaked paint is on `'painted'` (painterly). */
const PAINTED_SATURATION = 0.25;
/** Whimsical candy glaze: how much more saturated, and the glossy highlight's colour (× the tint) and strength. */
const CANDY_SATURATION = 0.5;
const GLAZE_COLOR = [1, 0.92, 0.97] as const;
const GLAZE = 0.6;
/** Enchanted: soaked surfaces are darker by this much more than the darkening, and their stars' colour and strength. */
const ENCHANTED_DARKER = 0.35;
const STAR_COLOR = [0.8, 0.84, 1] as const;
const STARS = 1.5;

const DEFAULTS: WetnessLook = {
  color: new Color('#dfe6ee'),
  slope: 140,
  softness: 60,
  strength: { bark: 1, leaves: 0.8, fruit: 0.5 },
  darkening: 0.4,
  sheen: 0.6,
};

/**
 * Makes the ready-made Wetness hooks: trees darken and get a sheen (a lower roughness) by the amount of
 * `wetness` (default {@link sceneWetness}), most on surfaces that face up, drawn to suit the Style:
 * smooth on `'standard'` (realistic), whole facets on `'flat'` (low-poly), and in toon bands with a light
 * glint band on top on `'toon'` (stylized; its lighting has no specular), and deeper, more saturated
 * paint with a soft brushed sheen on what faces up on `'painted'` (painterly; no specular either), a candy
 * glaze on `'whimsical'` (deep, saturated colour with a crisp glossy highlight on top; no specular either),
 * and a dark, glossy, starry sheen on `'enchanted'` (darker still, with tiny glints that twinkle as the view
 * moves; on leaves they glow with the Inner Glow). With the amount at 0 the trees look as without the hooks. They run before the app's own hooks in every stack.
 */
export function wetnessHooks(settings: WetnessSettings & { wetness?: Wetness } = {}): WetnessHooks {
  const source = settings.wetness ?? sceneWetness;
  const u = {
    color: uniform(DEFAULTS.color.clone()),
    // The normal's y at which wetness has faded out (dry, `slope`) and from which on it is full.
    dry: uniform(0),
    wet: uniform(0),
    strength: { bark: uniform(0), leaves: uniform(0), fruit: uniform(0) },
    darkening: uniform(0),
    sheen: uniform(0),
  };
  const look: WetnessLook = { ...DEFAULTS, color: DEFAULTS.color.clone(), strength: { ...DEFAULTS.strength } };

  // One hook for every part (it reads the part from its input), marked ready-made so it runs first.
  const hook = readyMadeShaderHook((input: TreeShaderInput) => {
    const { part, shading, color, roughness, normal, position } = input;
    const facing = smoothstep(u.dry, u.wet, normal.y);
    // Flat: each facet is wet or not; toon: bands of none, half and full; standard: smooth.
    const coverage: Node<'float'> =
      shading === 'flat' ? step(0.5, facing) : shading === 'toon' ? facing.mul(2).add(0.5).floor().mul(0.5) : facing;
    const w = coverage.mul(source.uniforms.amount).mul(u.strength[part]);
    const tint = u.color as unknown as Node<'vec3'>;
    const darkening = shading === 'enchanted' ? u.darkening.mul(1 + ENCHANTED_DARKER).min(1) : u.darkening;
    const soaked = color.mul(tint).mul(float(1).sub(darkening));
    let wetColor: Node<'vec3'> = mix(color, soaked, w);
    if (shading === 'toon') {
      // A light glint band on the surfaces that face most up: toon lighting draws no specular.
      const glint = smoothstep(0.8, 0.85, normal.y).mul(u.sheen).mul(w).mul(0.25);
      wetColor = wetColor.add(tint.mul(glint));
    } else if (shading === 'painted') {
      // Painterly: wet paint is deeper (a little more saturated as well as darker), and its sheen is a
      // soft, brushed light on what faces up: painted lighting draws no specular either.
      const luma = dot(wetColor, vec3(0.2126, 0.7152, 0.0722));
      wetColor = mix(wetColor, mix(vec3(luma), wetColor, 1 + PAINTED_SATURATION), w);
      const strokes = paintStrokes(position).mul(0.5).add(0.5);
      const glint = smoothstep(0.65, 0.95, normal.y).mul(smoothstep(0.45, 0.8, strokes)).mul(u.sheen).mul(w).mul(0.2);
      wetColor = wetColor.add(tint.mul(glint));
    } else if (shading === 'whimsical') {
      // Whimsical: a candy glaze. Wet sugar is deeper and more saturated, and the glaze has a crisp glossy
      // highlight on what faces up: whimsical lighting draws no specular, so it is painted in.
      const luma = dot(wetColor, vec3(0.2126, 0.7152, 0.0722));
      wetColor = mix(wetColor, mix(vec3(luma), wetColor, 1 + CANDY_SATURATION), w);
      const glaze = smoothstep(0.8, 0.84, normal.y).mul(u.sheen).mul(w).mul(GLAZE);
      wetColor = mix(wetColor, tint.mul(vec3(...GLAZE_COLOR)), glaze);
    } else if (shading === 'enchanted') {
      // Enchanted: a dark, starry sheen. Besides the gloss (its lighting has specular), a few tiny drops
      // catch the light like stars, twinkling as the view moves (on leaves they glow with the Inner Glow).
      const stars = glints(position, 30, 0.985).mul(u.sheen).mul(w).mul(STARS);
      wetColor = wetColor.add(tint.mul(vec3(...STAR_COLOR)).mul(stars));
    }
    return { color: wetColor, roughness: mix(roughness, roughness.mul(float(1).sub(u.sheen)), w) };
  });

  const hooks: WetnessHooks = {
    bark: hook,
    leaves: hook,
    fruit: hook,
    wetness: source,
    get settings() {
      return { ...look, color: look.color.clone(), strength: { ...look.strength } };
    },
    set(next: WetnessSettings) {
      // Checked in full before anything is written, so a bad value changes nothing.
      const slope = next.slope === undefined ? look.slope : degreesValue('Wetness slope', next.slope, 180);
      const softness = next.softness === undefined ? look.softness : softnessValue('Wetness softness', next.softness);
      const strength = strengthsWith('Wetness', look.strength, next.strength);
      const darkening = next.darkening === undefined ? look.darkening : unitValue('Wetness darkening', next.darkening);
      const sheen = next.sheen === undefined ? look.sheen : unitValue('Wetness sheen', next.sheen);
      if (next.color !== undefined) look.color.set(next.color);
      Object.assign(look, { slope, softness, strength, darkening, sheen });
      u.color.value.copy(look.color);
      const range = slopeRange(look.slope, look.softness);
      u.dry.value = range.none;
      u.wet.value = range.full;
      for (const part of TREE_PARTS) u.strength[part].value = look.strength[part];
      u.darkening.value = look.darkening;
      u.sheen.value = look.sheen;
      return this;
    },
  };
  return hooks.set(settings);
}
