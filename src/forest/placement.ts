// Pure Forest bookkeeping (no three.js): tree keys and the per-tree hash.
import type { VariationDefinition } from '../definition';
import type { Vec3 } from '../generator';
import { createRandom, hashCombine, seedToUint32 } from '../random';
import { clampGrowth } from '../growth/evaluate';
import { wrapSeason } from '../season/profile';

/** Where one tree of a Forest stands. */
export interface ForestPlacement {
  /** Position of the tree base, in the Forest's space. */
  position: Vec3 | { x: number; y: number; z: number };
  /** Radians: a number turns the tree about the vertical (Y) axis; [x, y, z] is an Euler rotation (XYZ order). Default 0. */
  rotation?: number | Vec3;
  /** Uniform scale. Default 1. */
  scale?: number;
  /**
   * A stable id. A tree's Variant and offsets come from it, so the tree keeps its look when it is
   * moved. Without an id they come from the position (rounded to 1 mm).
   */
  id?: string | number;
}

/** What the forest seed and a tree's key decide about that tree. */
export interface ForestTreeTraits {
  /** Which Variant (0 .. variants-1) the tree is drawn as. */
  variant: number;
  /** 0 .. `variation.growth`: how far behind the forest's Growth this tree grows. */
  growthDelay: number;
  /** Within ± `variation.season`: how far this tree's Season is shifted. */
  seasonShift: number;
  /** Radians, 0 .. 2π: so trees of one Variant do not sway in step. */
  windPhase: number;
}

export function placementPosition(placement: ForestPlacement): Vec3 {
  const p = placement.position;
  const v: Vec3 = Array.isArray(p) ? [p[0], p[1], p[2]] : [(p as { x: number }).x, (p as { y: number }).y, (p as { z: number }).z];
  if (!v.every(Number.isFinite)) throw new RangeError(`Forest placement position must be finite, got [${v.join(', ')}]`);
  return v;
}

/**
 * The key a tree is known by: its id as a string (so ids 1 and "1" are the same tree), or
 * `@x,y,z` (position in millimetres) when it has no id.
 */
export function forestTreeKey(placement: ForestPlacement): string {
  if (placement.id !== undefined) return String(placement.id);
  const mm = placementPosition(placement).map((c) => Math.round(c * 1000) || 0); // `|| 0` folds -0 into 0
  return `@${mm.join(',')}`;
}

/** The Seed of Variant `index` of a forest. */
export function variantSeed(forestSeed: number, index: number): number {
  return hashCombine(seedToUint32(forestSeed), 0x7a71a7, index);
}

/**
 * A tree's Variant and offsets: a hash of the forest seed and the tree's key only, so they never
 * depend on the tree's index in the list or on which other trees exist.
 */
export function forestTreeTraits(
  forestSeed: number,
  key: string,
  variants: number,
  variation: Pick<VariationDefinition, 'growth' | 'season'>,
): ForestTreeTraits {
  const random = createRandom(forestSeed).fork('forest').fork(key);
  return {
    variant: random.int(0, variants - 1),
    growthDelay: random.next() * variation.growth,
    seasonShift: (random.next() * 2 - 1) * variation.season,
    windPhase: random.next() * Math.PI * 2,
  };
}

/**
 * The Growth one tree is drawn at, for a Growth `growth` set on it: delayed by its `growthDelay`
 * but still exactly 0 at Growth 0 and 1 at Growth 1, so a fully grown forest is fully grown.
 */
export function delayedGrowth(growth: number, delay: number): number {
  const g = clampGrowth(growth);
  return delay > 0 ? clampGrowth((g - delay) / (1 - delay)) : g;
}

/** The Season one tree is drawn at: the Season set on it plus its shift, wrapped into 0..1. */
export function shiftedSeason(season: number, shift: number): number {
  return wrapSeason(season + shift);
}
