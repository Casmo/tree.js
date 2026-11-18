import { Vector3, type UniformNode } from 'three/webgpu';
import { uniform } from 'three/tsl';

export type WindDirection = Vector3 | readonly [number, number, number];

export interface WindOptions {
  /** World-space direction the wind blows towards (any length > 0; stored as a unit vector). Default +X. */
  direction?: WindDirection;
  /** 0 = calm (default), 1 = strong wind; larger values are allowed for storms. */
  strength?: number;
}

/**
 * Scene-wide Wind: a direction and a strength that every tree listening to it sways with.
 * Changing them only writes uniform values (no recompile). Trees use {@link sceneWind} unless
 * `createTree(..., { wind })` names another one. How much each tree moves is its Definition's
 * Wind response (`definition.wind`).
 */
export class Wind {
  /** The shared TSL uniforms tree materials read. Write through the setters, not here. */
  readonly uniforms: {
    readonly direction: UniformNode<'vec3', Vector3>;
    readonly strength: UniformNode<'float', number>;
    /** Seconds; follows the renderer clock unless {@link Wind.time} pins it. */
    readonly time: UniformNode<'float', number>;
  };
  private pinnedTime: number | null = null;

  constructor(options: WindOptions = {}) {
    this.uniforms = {
      direction: uniform(new Vector3(1, 0, 0)),
      strength: uniform(0),
      time: uniform(0).onRenderUpdate((frame) => this.pinnedTime ?? frame.time),
    };
    this.set(options);
  }

  /** Unit direction the wind blows towards (a copy: assign a new value to change it). */
  get direction(): Vector3 {
    return this.uniforms.direction.value.clone();
  }

  set direction(value: WindDirection) {
    const v = Array.isArray(value) ? new Vector3(...(value as [number, number, number])) : (value as Vector3).clone();
    const length = v.length();
    if (!Number.isFinite(length) || length === 0) {
      throw new RangeError(`Wind direction must be a finite, non-zero vector, got [${v.toArray().join(', ')}]`);
    }
    this.uniforms.direction.value.copy(v.divideScalar(length));
  }

  get strength(): number {
    return this.uniforms.strength.value;
  }

  set strength(value: number) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Wind strength must be a finite number >= 0, got ${value}`);
    this.uniforms.strength.value = value;
  }

  /**
   * Pins the Wind clock to a time in seconds (pause, deterministic screenshots), or `null`
   * (default) to follow the renderer's clock.
   */
  get time(): number | null {
    return this.pinnedTime;
  }

  set time(value: number | null) {
    this.pinnedTime = value;
    if (value !== null) this.uniforms.time.value = value;
  }

  /** Sets direction and/or strength; returns this. */
  set(options: WindOptions): this {
    if (options.direction !== undefined) this.direction = options.direction;
    if (options.strength !== undefined) this.strength = options.strength;
    return this;
  }
}

/** The scene-wide Wind every tree sways with by default. */
export const sceneWind = new Wind();

/** The uniforms Wind nodes read: those of a {@link Wind}, or of a {@link WindBinding}. */
export type WindUniforms = Wind['uniforms'];

/**
 * Per-object Wind uniforms that follow whichever Wind is bound to them, read once per render.
 * Trees and Forests build their Wind nodes on these, so switching to another Wind is one
 * assignment: no new nodes, no recompile, no regeneration.
 */
export class WindBinding {
  /** The bound Wind. */
  wind: Wind;
  readonly uniforms: WindUniforms;

  constructor(wind: Wind) {
    this.wind = wind;
    const direction = wind.uniforms.direction.value.clone();
    this.uniforms = {
      direction: uniform(direction).onRenderUpdate(() => direction.copy(this.wind.uniforms.direction.value)),
      strength: uniform(wind.strength).onRenderUpdate(() => this.wind.strength),
      time: uniform(0).onRenderUpdate((frame) => this.wind.time ?? frame.time),
    };
  }
}
