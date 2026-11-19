import { Vector3, Vector4, type UniformArrayNode, type UniformNode } from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';

export type WindDirection = Vector3 | readonly [number, number, number];

export interface WindOptions {
  /** World-space direction the wind blows towards (any length > 0; stored as a unit vector). Default +X. */
  direction?: WindDirection;
  /** 0 = calm (default), 1 = strong wind; larger values are allowed for storms. */
  strength?: number;
}

/** A {@link Wind.burst}: where on the ground, how hard and how far. */
export interface WindBurstOptions {
  /** World-space ground point (x, z) the air pushes away from. */
  x: number;
  z: number;
  /**
   * How hard it pushes (default 1). Weaker values push less; a negative value is the reduced-motion
   * burst: trees in reach lean away at once (no travelling front, no swing back) and settle, with
   * the size of the value as strength.
   */
  strength?: number;
  /** Metres it reaches (> 0). Default {@link WIND_BURST_REACH} per unit of strength. */
  radius?: number;
}

/** A running Wind Burst, as {@link Wind.bursts} lists it. */
export interface WindBurst {
  readonly x: number;
  readonly z: number;
  readonly strength: number;
  readonly radius: number;
  /** The Wind time (seconds) it started at. */
  readonly start: number;
}

/** Seconds a Wind Burst lasts. */
export const WIND_BURST_LIFETIME = 1.2;
/** Most Wind Bursts one Wind runs at once; a new one beyond it replaces the oldest. */
export const MAX_WIND_BURSTS = 8;
/** Metres a Wind Burst reaches per unit of strength, unless given a `radius`. */
export const WIND_BURST_REACH = 8;

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
    /** Wind Bursts (see {@link WindBurstUniforms}). */
    readonly bursts: WindBurstUniforms;
  };
  private pinnedTime: number | null = null;
  /** The renderer clock as last seen by a render (the Wind time when not pinned). */
  private clock = 0;
  /** Running and recently ended bursts, oldest first (at most {@link MAX_WIND_BURSTS}). */
  private started: WindBurst[] = [];

  constructor(options: WindOptions = {}) {
    this.uniforms = {
      direction: uniform(new Vector3(1, 0, 0)),
      strength: uniform(0),
      time: uniform(0).onRenderUpdate((frame) => this.timeAt(frame.time)),
      bursts: burstUniforms(() => this),
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

  /**
   * Starts a Wind Burst: a short push of air from a ground point that bends the trees within its
   * radius away from it and fades out within {@link WIND_BURST_LIFETIME} seconds of Wind time, on top
   * of the Wind. At most {@link MAX_WIND_BURSTS} run at once; another one replaces the oldest. Only
   * uniform writes (no recompile). Returns this.
   */
  burst({ x, z, strength = 1, radius = WIND_BURST_REACH * Math.abs(strength) }: WindBurstOptions): this {
    for (const [name, value] of Object.entries({ x, z, strength })) {
      if (!Number.isFinite(value)) throw new RangeError(`Wind burst ${name} must be a finite number, got ${value}`);
    }
    if (!(radius > 0 && Number.isFinite(radius))) throw new RangeError(`Wind burst radius must be > 0, got ${radius}`);
    const running = this.bursts;
    if (running.length === MAX_WIND_BURSTS) running.shift();
    this.started = [...running, { x, z, strength, radius, start: this.now }];
    return this;
  }

  /**
   * @internal The bursts the shader loops over (oldest first, at most {@link MAX_WIND_BURSTS}): the
   * started ones while any of them runs, else none. They only change in {@link Wind.burst}; the
   * shader leaves out those that have not started or have ended.
   */
  get drawnBursts(): readonly WindBurst[] {
    const last = this.started.at(-1);
    return last && this.now - last.start <= WIND_BURST_LIFETIME ? this.started : [];
  }

  /** The Wind Bursts running at the current Wind time, oldest first. */
  get bursts(): WindBurst[] {
    const now = this.now;
    return this.started.filter((burst) => now >= burst.start && now - burst.start <= WIND_BURST_LIFETIME);
  }

  /**
   * @internal The Wind time of a render at renderer time `frameTime` (called once per render by
   * the Wind's own and its bindings' time uniforms): the pinned time, or that clock, which it keeps.
   */
  timeAt(frameTime: number): number {
    this.clock = frameTime;
    return this.now;
  }

  /** The current Wind time: the pinned time, or the renderer clock as of the last render. */
  private get now(): number {
    return this.pinnedTime ?? this.clock;
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
      time: uniform(0).onRenderUpdate((frame) => this.wind.timeAt(frame.time)),
      bursts: burstUniforms(() => this.wind),
    };
  }
}

/**
 * The Wind Burst uniforms tree materials read: a fixed-size array of {@link MAX_WIND_BURSTS} slots,
 * and how many of them to loop over (0 when no burst runs, so the loop costs nothing).
 */
export interface WindBurstUniforms {
  /** Per slot: x, z (world-space ground point), start (Wind time), strength. */
  readonly points: UniformArrayNode<'vec4'>;
  /** Per slot: the radius in metres. */
  readonly radii: UniformArrayNode<'float'>;
  readonly count: UniformNode<'int', number>;
}

/** Burst uniforms that follow the bursts of `wind()`, read once per render. */
function burstUniforms(wind: () => Wind): WindBurstUniforms {
  const points = Array.from({ length: MAX_WIND_BURSTS }, () => new Vector4());
  const radii = new Array<number>(MAX_WIND_BURSTS).fill(1);
  return {
    points: uniformArray(points, 'vec4').onRenderUpdate(() => {
      wind().drawnBursts.forEach((b, i) => points[i]!.set(b.x, b.z, b.start, b.strength));
    }) as UniformArrayNode<'vec4'>,
    radii: uniformArray(radii, 'float').onRenderUpdate(() => {
      wind().drawnBursts.forEach((b, i) => (radii[i] = b.radius));
    }) as UniformArrayNode<'float'>,
    count: uniform(0, 'int').onRenderUpdate(() => wind().drawnBursts.length) as UniformNode<'int', number>,
  };
}
