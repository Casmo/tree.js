import type { PartSeason } from '../season/profile';
import type { GrowthWindow, LeafGrowth, TreeAttributes, Vec3 } from './types';
import { NO_SWAY, type PartSway } from './wind';

/** The facts shared by every vertex of one part (branch or leaf). */
export interface PartInfo {
  level: number;
  attach: number;
  random: number;
  origin: Vec3;
  growth: GrowthWindow;
  /** A leaf's twig (its sprout window and base point), written as `aTwigGrowth` / `aTwigOrigin` (leaf buffers only). */
  twig?: { growth: GrowthWindow; origin: Vec3 };
  /** Season timing, written as `aSeason` (vec3: shift, coverage rank, blossom rank). */
  season: PartSeason;
  /** Wind weights of the part (branch sway, leaf flutter); trunk sway is filled in from heights. */
  sway?: PartSway;
}

/** Allocates the per-vertex attributes of a wood (or Fruit) mesh for `vertexCount` vertices. */
export function createAttributes(vertexCount: number): TreeAttributes {
  const scalar = () => ({ array: new Float32Array(vertexCount), itemSize: 1 });
  return {
    aLevel: scalar(),
    aAlong: scalar(),
    aAttach: scalar(),
    aRandom: scalar(),
    aOrigin: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
    aGrowth: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
    aSeason: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
    aWind: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
  };
}

/**
 * Allocates the per-vertex attributes of a leaf mesh for `vertexCount` vertices: those of
 * {@link createAttributes} plus the twig a leaf rides on (`aTwigGrowth`, `aTwigOrigin`, ADR 0020).
 */
export function createLeafAttributes(vertexCount: number): TreeAttributes {
  return {
    aTwigGrowth: { array: new Float32Array(vertexCount * 2), itemSize: 2 },
    aTwigOrigin: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
    ...createAttributes(vertexCount),
  };
}

/** Writes one vertex's attributes; `radius` = its distance from the part's centre line. */
export function writePart(attributes: TreeAttributes, v: number, part: PartInfo, along: number, radius = 0): void {
  attributes.aLevel.array[v] = part.level;
  attributes.aAlong.array[v] = along;
  attributes.aAttach.array[v] = part.attach;
  attributes.aRandom.array[v] = part.random;
  attributes.aOrigin.array.set(part.origin, v * 3);
  attributes.aGrowth.array.set([part.growth.start, part.growth.end, radius], v * 3);
  attributes.aSeason.array.set([part.season.shift, part.season.coverageRank, part.season.blossomRank], v * 3);
  if (part.twig) {
    attributes.aTwigGrowth!.array.set([part.twig.growth.start, part.twig.growth.end], v * 2);
    attributes.aTwigOrigin!.array.set(part.twig.origin, v * 3);
  }
  const sway = part.sway ?? NO_SWAY;
  attributes.aWind.array[v * 3 + 1] = Math.min(sway.base + sway.gain * along, 1);
  attributes.aWind.array[v * 3 + 2] = sway.flutter ? along : 0;
}

/** The Growth facts of one leaf part: its own window, and its twig's (to ride on). Fully grown without `growth`. */
export function leafPartGrowth(growth: LeafGrowth | undefined, origin: Vec3): Pick<PartInfo, 'growth' | 'twig'> {
  return {
    growth: growth?.leaf ?? { start: 0, end: 0 },
    twig: { growth: growth?.twig ?? { start: 0, end: 0 }, origin: growth?.twigOrigin ?? origin },
  };
}
