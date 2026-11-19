// Forest Detail Levels (ADR 0010): the options, their validation and defaults, and the pure
// level selection that the GPU compute pass mirrors. No three.js at runtime.
import type { Camera } from 'three/webgpu';
import type { TreeDefinitionInput } from '../definition';

/** A Forest tree's Detail Level (GLOSSARY): Full (as without Detail Levels), Light (fewer faces and leaves) or Impostor (one card). */
export const DetailLevel = { Full: 0, Light: 1, Impostor: 2 } as const;
export type DetailLevel = (typeof DetailLevel)[keyof typeof DetailLevel];

/** Resolution of a Variant's Impostor atlases. */
export interface ImpostorAtlasOptions {
  /** Octahedral directions per side (frames × frames pictures). Default 12. */
  frames?: number;
  /** Atlas width and height in pixels. Default 2048. */
  size?: number;
}

/** The Detail Levels of a Forest (`ForestOptions.lod`). */
export interface ForestLodOptions {
  /** Camera distance (world units, divided by the tree's placement scale) from which a tree draws Light. */
  light: number;
  /** Camera distance (as `light`, at least `light`) from which a fully grown tree draws as an Impostor. */
  impostor: number;
  /** Width of the cross-fade band, as a fraction (0..1) of each switch distance, centred on it. Default 0.1. */
  fade?: number;
  /** Impostor atlas resolution. Default 12 × 12 directions at 2048². */
  impostorAtlas?: ImpostorAtlasOptions;
  /** Partial Definition merged over the automatic Light reduction of every Variant. */
  lightDefinition?: Omit<TreeDefinitionInput, 'schemaVersion'>;
  /** The camera whose distance picks every tree's level. Default: the first non-shadow camera that draws the Forest in a frame. */
  camera?: Camera | null;
}

/** A Forest's current Detail Level settings (`forest.lod`), every default filled in. */
export interface ForestLodSettings {
  light: number;
  impostor: number;
  fade: number;
  impostorAtlas: Required<ImpostorAtlasOptions>;
  lightDefinition: Omit<TreeDefinitionInput, 'schemaVersion'> | null;
  /** null: the first non-shadow camera that draws the Forest in a frame. */
  camera: Camera | null;
}

/** What `forest.lod = …` can change live (only uniforms are written: no rebuild, no recompile). */
export type ForestLodUpdate = Partial<Pick<ForestLodSettings, 'light' | 'impostor' | 'fade' | 'camera'>>;

/** The distances the level selection needs. */
export type DetailLevelDistances = Pick<ForestLodSettings, 'light' | 'impostor' | 'fade'>;

/** A tree's Detail Level and how far it has faded into the next one. */
export interface DetailLevelSelection {
  /** The nearer level the tree draws at. */
  level: DetailLevel;
  /**
   * 0..1: how far the tree is into the cross-fade towards `level + 1`. The tree draws at `level`
   * with amount `1 - fade` and, when `fade > 0`, also at `level + 1` with amount `fade`.
   */
  fade: number;
}

export const DEFAULT_LOD_FADE = 0.1;
export const DEFAULT_IMPOSTOR_ATLAS: Required<ImpostorAtlasOptions> = { frames: 12, size: 2048 };
/** `lod: true`: Light from this many trunk heights away, Impostor from … */
export const DEFAULT_LIGHT_HEIGHTS = 6;
/** … this many trunk heights away. */
export const DEFAULT_IMPOSTOR_HEIGHTS = 20;
/** Smallest placement scale the selection divides by (a scale of 0 must not divide by zero). */
export const MIN_LOD_SCALE = 1e-6;

/** 0 below `start`, 1 from `end`, linear in between (a band of width 0 is a hard step at `end`). */
function ramp(x: number, start: number, end: number): number {
  if (end <= start) return x >= end ? 1 : 0;
  return Math.min(Math.max((x - start) / (end - start), 0), 1);
}

/**
 * Picks a Forest tree's Detail Level. The single source of truth for level selection: the GPU
 * compute pass mirrors it line by line.
 *
 * - `t = distance / max(scale, 1e-6)`: a tree at placement scale 2 switches at twice the distance.
 * - Each switch distance `d` (`light`, `impostor`) has a cross-fade band from `d·(1 − fade/2)` to
 *   `d·(1 + fade/2)`; inside it the tree fades linearly from the nearer level to the next one.
 * - A tree whose drawn Growth is below 1 is never an Impostor: it is capped at Light.
 * - The Impostor switch is checked first, so if the two bands overlap the farther one wins.
 *
 * @param distance distance from the camera that picks the levels to the tree's base, world units
 * @param scale the tree's placement scale
 * @param growth the tree's drawn Growth (after its Growth delay)
 */
export function selectDetailLevel(distance: number, scale: number, growth: number, settings: DetailLevelDistances): DetailLevelSelection {
  const t = distance / Math.max(scale, MIN_LOD_SCALE);
  const half = settings.fade / 2;
  if (growth >= 1) {
    const toImpostor = ramp(t, settings.impostor * (1 - half), settings.impostor * (1 + half));
    if (toImpostor >= 1) return { level: DetailLevel.Impostor, fade: 0 };
    if (toImpostor > 0) return { level: DetailLevel.Light, fade: toImpostor };
  }
  const toLight = ramp(t, settings.light * (1 - half), settings.light * (1 + half));
  if (toLight >= 1) return { level: DetailLevel.Light, fade: 0 };
  return { level: DetailLevel.Full, fade: toLight };
}

function checkDistance(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Forest lod.${name} must be a finite distance >= 0, got ${value}`);
}

/** Throws a RangeError unless the distances and fade are valid. */
export function checkDetailLevelDistances({ light, impostor, fade }: DetailLevelDistances): void {
  checkDistance('light', light);
  checkDistance('impostor', impostor);
  if (impostor < light) throw new RangeError(`Forest lod.impostor (${impostor}) must be at least lod.light (${light})`);
  if (!(fade >= 0 && fade <= 1)) throw new RangeError(`Forest lod.fade must be within 0..1, got ${fade}`);
}

function checkAtlas(name: keyof ImpostorAtlasOptions, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`Forest lod.impostorAtlas.${name} must be an integer >= 1, got ${value}`);
}

/** The switch distances of `lod: true`, from the tallest Variant's trunk height. */
export function defaultDetailLevelDistances(trunkHeight: number): Pick<ForestLodSettings, 'light' | 'impostor'> {
  return { light: trunkHeight * DEFAULT_LIGHT_HEIGHTS, impostor: trunkHeight * DEFAULT_IMPOSTOR_HEIGHTS };
}

/**
 * The settings of `ForestOptions.lod` with every default filled in, or null when it is missing or
 * false. `trunkHeight` (the tallest Variant's) gives the distances of `lod: true`. Throws a RangeError
 * for invalid settings.
 */
export function resolveForestLod(lod: boolean | ForestLodOptions | undefined, trunkHeight: number): ForestLodSettings | null {
  if (lod === undefined || lod === false) return null;
  const options: ForestLodOptions = lod === true ? defaultDetailLevelDistances(trunkHeight) : lod;
  const settings: ForestLodSettings = {
    light: options.light,
    impostor: options.impostor,
    fade: options.fade ?? DEFAULT_LOD_FADE,
    impostorAtlas: { ...DEFAULT_IMPOSTOR_ATLAS, ...options.impostorAtlas },
    lightDefinition: options.lightDefinition ?? null,
    camera: options.camera ?? null,
  };
  checkDetailLevelDistances(settings);
  checkAtlas('frames', settings.impostorAtlas.frames);
  checkAtlas('size', settings.impostorAtlas.size);
  return settings;
}

/** Side of the ordered-dither (Bayer) matrix the cross-fade uses. */
export const DITHER_SIZE = 8;

/**
 * The cross-fade threshold of screen pixel (x, y), in 0..1: an 8 × 8 Bayer matrix, the same in every
 * frame (no temporal noise), so a still frame is deterministic. The GPU mirrors it bit for bit.
 */
export function ditherThreshold(x: number, y: number): number {
  const px = Math.floor(x) & 7;
  const py = Math.floor(y) & 7;
  const v = px ^ py;
  const rank = ((v & 1) << 5) | ((py & 1) << 4) | ((v & 2) << 2) | ((py & 2) << 1) | ((v & 4) >> 1) | ((py & 4) >> 2);
  return (rank + 0.5) / (DITHER_SIZE * DITHER_SIZE);
}

/**
 * Whether a tree drawn at a level shows a pixel with dither `threshold`. A tree at `level` with
 * `fade` shows the nearer level where `threshold < 1 − fade` and the next level (`next`) everywhere
 * else, so the two levels together cover every pixel exactly once.
 */
export function showsPixel(fade: number, next: boolean, threshold: number): boolean {
  return next ? threshold >= 1 - fade : threshold < 1 - fade;
}
