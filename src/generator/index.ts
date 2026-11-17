import type { TreeDefinition } from '../definition';
import { createRandom, hashBytes } from '../random';
import { buildBranches } from './branches';
import { leafGeometry, placeLeaves } from './leaves';
import { mergeBuffers, sweepBranch } from './mesh';
import { buildTrunk } from './trunk';
import type { GeometryBuffers, TreeData } from './types';

export type { GeometryBuffers, SkeletonBranch, SkeletonLeaf, SkeletonPoint, TreeData, TreeSkeleton, Vec3 } from './types';

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
  const branches = [trunk, ...buildBranches(definition, trunk, random.fork('branches'))];
  const sidesOf = (level: number) => (level === 0 ? definition.trunk.sides : definition.branches[level - 1]!.sides);
  const leaves = placeLeaves(definition, branches, random.fork('leaves'));
  return {
    seed,
    skeleton: { branches, leaves },
    wood: mergeBuffers(branches.map((b) => sweepBranch(b, sidesOf(b.level)))),
    leaves: leafGeometry(leaves),
  };
}

/** Stable 32-bit hash (hex) of the generated geometry buffers, for determinism checks. */
export function hashGeometry(geometry: GeometryBuffers): string {
  return hex(hashBuffers(geometry));
}

/** Stable hash of a tree's generated geometry (wood and leaves). */
export function hashTreeData(data: TreeData): string {
  return hex(hashBuffers(data.leaves, hashBuffers(data.wood)));
}

function hashBuffers(geometry: GeometryBuffers, h?: number): number {
  const arrays = [geometry.positions, geometry.normals, geometry.uvs, geometry.colors, geometry.indices];
  for (const array of arrays) {
    if (array) h = hashBytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), h);
  }
  return h!;
}

const hex = (h: number) => h.toString(16).padStart(8, '0');
