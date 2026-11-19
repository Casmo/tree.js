import { float, mix, smoothstep, step, uniform } from 'three/tsl';
import { Color, type ColorRepresentation, type Node, type UniformNode } from 'three/webgpu';
import type { TreePart } from '../effects/mask';
import { readyMadeShaderHook, type TreeShaderHook, type TreeShaderInput } from '../materials/shader-hooks';

export interface WetnessOptions {
  /** How wet the trees are: 0 = dry (default), 1 = soaked. */
  amount?: number;
}

/**
 * A scene-wide wetness amount (0..1) that every {@link wetnessHooks} hook reading it follows, as after
 * rain. Shared like `sceneWind`: hooks use {@link sceneWetness} unless given another one. Changing it only
 * writes a uniform (no recompile).
 */
export class Wetness {
  /** The shared TSL uniforms the hooks read. Write through the setters, not here. */
  readonly uniforms: { readonly amount: UniformNode<'float', number> };

  constructor(options: WetnessOptions = {}) {
    this.uniforms = { amount: uniform(0) };
    this.set(options);
  }

  get amount(): number {
    return this.uniforms.amount.value;
  }

  set amount(value: number) {
    if (!(value >= 0 && value <= 1)) throw new RangeError(`Wetness amount must be a number in 0..1, got ${value}`);
    this.uniforms.amount.value = value;
  }

  /** Sets the amount; returns this. */
  set(options: WetnessOptions): this {
    if (options.amount !== undefined) this.amount = options.amount;
    return this;
  }
}

/** The scene-wide wetness every Wetness hook follows by default. */
export const sceneWetness = new Wetness();

/** How a {@link wetnessHooks} hook looks; every setting is live (a uniform write, no rebuild). */
export interface WetnessSettings {
  /** The tint wet surfaces take on (multiplied into their colour). Default a cool grey, `#dfe6ee`. */
  color?: ColorRepresentation;
  /**
   * The steepest surface that still gets fully wet, in degrees from facing straight up (0..180): a
   * surface facing further down stays drier. Default 110 (only undersides stay drier).
   */
  slope?: number;
  /** Degrees (>= 0) over which wetness fades out around `slope`. Default 60; 0 is a hard edge. */
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

const DEFAULTS: WetnessLook = {
  color: new Color('#dfe6ee'),
  slope: 110,
  softness: 60,
  strength: { bark: 1, leaves: 0.8, fruit: 0.5 },
  darkening: 0.4,
  sheen: 0.6,
};

const unit = (name: string, value: number): number => {
  if (!(value >= 0 && value <= 1)) throw new RangeError(`Wetness ${name} must be a number in 0..1, got ${value}`);
  return value;
};

/** The cosine of an angle in degrees, clamped to 0..180. */
const cosOf = (degrees: number): number => Math.cos((Math.min(180, Math.max(0, degrees)) * Math.PI) / 180);

/**
 * Makes the ready-made Wetness hooks: trees darken and get a sheen (a lower roughness) by the amount of
 * `wetness` (default {@link sceneWetness}), most on surfaces that face up, drawn to suit the Style:
 * smooth on `'standard'` (realistic), whole facets on `'flat'` (low-poly), and in toon bands with a light
 * glint band on top on `'toon'` (stylized; its lighting has no specular). With the amount at 0 the trees
 * look as without the hooks. They run before the app's own hooks in every stack.
 */
export function wetnessHooks(settings: WetnessSettings & { wetness?: Wetness } = {}): WetnessHooks {
  const source = settings.wetness ?? sceneWetness;
  const u = {
    color: uniform(DEFAULTS.color.clone()),
    // The normal's y where wetness has faded out (dry) and where it is full.
    dry: uniform(0),
    wet: uniform(0),
    strength: { bark: uniform(0), leaves: uniform(0), fruit: uniform(0) },
    darkening: uniform(0),
    sheen: uniform(0),
  };
  const look: WetnessLook = { ...DEFAULTS, color: DEFAULTS.color.clone(), strength: { ...DEFAULTS.strength } };

  const hook = (input: TreeShaderInput) => {
    const { part, shading, color, roughness, normal } = input;
    const facing = smoothstep(u.dry, u.wet, normal.y);
    // Flat: each facet is wet or not; toon: bands of none, half and full; standard: smooth.
    const coverage: Node<'float'> =
      shading === 'flat' ? step(0.5, facing) : shading === 'toon' ? facing.mul(2).add(0.5).floor().mul(0.5) : facing;
    const w = coverage.mul(source.uniforms.amount).mul(u.strength[part]);
    const tint = u.color as unknown as Node<'vec3'>;
    const soaked = color.mul(tint).mul(float(1).sub(u.darkening));
    let wetColor: Node<'vec3'> = mix(color, soaked, w);
    if (shading === 'toon') {
      // A light glint band on the surfaces that face most up: toon lighting draws no specular.
      const glint = smoothstep(0.8, 0.85, normal.y).mul(u.sheen).mul(w).mul(0.25);
      wetColor = wetColor.add(tint.mul(glint));
    }
    return { color: wetColor, roughness: mix(roughness, roughness.mul(float(1).sub(u.sheen)), w) };
  };

  const hooks: WetnessHooks = {
    bark: readyMadeShaderHook(hook),
    leaves: hook,
    fruit: hook,
    wetness: source,
    get settings() {
      return { ...look, color: look.color.clone(), strength: { ...look.strength } };
    },
    set(next: WetnessSettings) {
      // Checked in full before anything is written, so a bad value changes nothing.
      if (next.slope !== undefined && !Number.isFinite(next.slope)) throw new RangeError(`Wetness slope must be a finite number, got ${next.slope}`);
      if (next.softness !== undefined && !(next.softness >= 0 && Number.isFinite(next.softness))) {
        throw new RangeError(`Wetness softness must be a finite number >= 0, got ${next.softness}`);
      }
      const strength = { ...look.strength };
      for (const part of ['bark', 'leaves', 'fruit'] as const) {
        const value = next.strength?.[part];
        if (value !== undefined) strength[part] = unit(`${part} strength`, value);
      }
      const darkening = next.darkening === undefined ? look.darkening : unit('darkening', next.darkening);
      const sheen = next.sheen === undefined ? look.sheen : unit('sheen', next.sheen);
      if (next.color !== undefined) look.color.set(next.color);
      Object.assign(look, { slope: next.slope ?? look.slope, softness: next.softness ?? look.softness, strength, darkening, sheen });
      u.color.value.copy(look.color);
      u.dry.value = cosOf(look.slope + look.softness / 2);
      u.wet.value = Math.max(cosOf(look.slope - look.softness / 2), u.dry.value + 1e-4);
      for (const part of ['bark', 'leaves', 'fruit'] as const) u.strength[part].value = look.strength[part];
      u.darkening.value = look.darkening;
      u.sheen.value = look.sheen;
      return this;
    },
  };
  return hooks.set(settings);
}
