import type { TreeDefinition } from '../definition';
import { createRandom, hashBytes } from '../random';
import { sweepBranch } from './mesh';
import { buildTrunk } from './trunk';
import type { GeometryBuffers, TreeData } from './types';

export type { GeometryBuffers, SkeletonBranch, SkeletonPoint, TreeData, TreeSkeleton, Vec3 } from './types';

/**
 * The Generator: a pure function from a (parsed) Tree Definition and a Seed to tree data.
 * No three.js, no GPU, no globals; runs in Node. Same input, same output, on every machine.
 *
 * Each part of the tree draws from its own `random.fork(<part>)` stream so that adding
 * a new part never shifts the numbers of an existing one.
 */
export function generateTree(definition: TreeDefinition, seed: number): TreeData {
  const random = createRandom(seed);
  const trunk = buildTrunk(definition, random.fork('trunk'));
  return {
    seed,
    skeleton: { branches: [trunk] },
    geometry: sweepBranch(trunk, definition.trunk.sides),
  };
}

/** Stable 32-bit hash (hex) of the generated geometry buffers, for determinism checks. */
export function hashGeometry(geometry: GeometryBuffers): string {
  let h: number | undefined;
  for (const array of [geometry.positions, geometry.normals, geometry.uvs, geometry.indices]) {
    h = hashBytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), h);
  }
  return h!.toString(16).padStart(8, '0');
}

/** Stable hash of a tree's generated geometry. */
export function hashTreeData(data: TreeData): string {
  return hashGeometry(data.geometry);
}
