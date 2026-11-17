import { hashCombine, hashString, seedToUint32 } from '../random';
import type { TreeAttributes, Vec3 } from './types';

/** Stable 0..1 number for a part, from the Seed and its branch path or leaf id (no stream draws). */
export function partRandom(seed: number, key: string): number {
  return hashCombine(seedToUint32(seed), hashString(key)) / 4294967296;
}

/** The facts shared by every vertex of one part (branch or leaf). */
export interface PartInfo {
  level: number;
  attach: number;
  random: number;
  origin: Vec3;
  /** `aSeason` (vec3): Season timing shift, coverage rank, blossom rank (see src/season). */
  season: Vec3;
}

/** Allocates the per-vertex attributes for `vertexCount` vertices. */
export function createAttributes(vertexCount: number): TreeAttributes {
  const scalar = () => ({ array: new Float32Array(vertexCount), itemSize: 1 });
  return {
    aLevel: scalar(),
    aAlong: scalar(),
    aAttach: scalar(),
    aRandom: scalar(),
    aOrigin: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
    aSeason: { array: new Float32Array(vertexCount * 3), itemSize: 3 },
  };
}

/** Writes one vertex's attributes. */
export function writePart(attributes: TreeAttributes, v: number, part: PartInfo, along: number): void {
  attributes.aLevel.array[v] = part.level;
  attributes.aAlong.array[v] = along;
  attributes.aAttach.array[v] = part.attach;
  attributes.aRandom.array[v] = part.random;
  attributes.aOrigin.array.set(part.origin, v * 3);
  attributes.aSeason.array.set(part.season, v * 3);
}
