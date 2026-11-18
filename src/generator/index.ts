import type { TreeDefinition } from '../definition';
import { createRandom, hashBytes, seedRandom } from '../random';
import { woodSeasonAttribute } from '../season/profile';
import { buildBranches } from './branches';
import { growthTiming } from './growth';
import { solidLeafGeometry } from './leaf-shapes';
import { leafGeometry, placeLeaves } from './leaves';
import { mergeBuffers, sweepBranch } from './mesh';
import { sculptBranches, sculptLeaves, sculptsFor } from './sculpt';
import { buildStems } from './trunk';
import { branchSway, writeTrunkSway } from './wind';
import type { GeometryBuffers, TreeData, TreeSkeleton } from './types';

export { growthTiming } from './growth';
export type { GrowthTiming, GrowthWindow, GeometryBuffers, TreeAttributes, VertexAttribute, SkeletonBranch, SkeletonLeaf, SkeletonPoint, TreeData, TreeSkeleton, Vec3 } from './types';

/**
 * The Generator: a pure function from a (parsed) Tree Definition and a Seed to tree data.
 * No three.js, no GPU, no globals; runs in Node. Same input, same output, on every machine.
 *
 * Each part of the tree draws from its own `random.fork(<part>)` stream so that adding
 * a new part never shifts the numbers of an existing one.
 */
export function generateTree(definition: TreeDefinition, seed: number): TreeData {
  const random = createRandom(seed);
  const stems = buildStems(definition, random);
  const sculpts = sculptsFor(definition, seed);
  const branches = sculptBranches([...stems, ...buildBranches(definition, stems, random.fork('branches'))], sculpts);
  const sidesOf = (level: number) => (level === 0 ? definition.trunk.sides : definition.branches[level - 1]!.sides);
  const leaves = sculptLeaves(placeLeaves(definition, branches, random.fork('leaves')), sculpts, seed);
  const growth = growthTiming(definition, seed, branches, leaves);
  const sway = branchSway(branches, definition.branches.length);
  const wood = mergeBuffers(
    branches.map((b, i) =>
      sweepBranch(
        b,
        sidesOf(b.level),
        seedRandom(seed, b.path),
        woodSeasonAttribute(seed, definition.variation),
        growth.branches[i],
        sway.get(b.path),
      ),
    ),
  );
  const leafBuffers =
    definition.leaves.shape === 'card'
      ? leafGeometry(leaves, definition.branches.length + 1, seed, definition.variation, growth.leaves, sway)
      : solidLeafGeometry(leaves, definition.leaves.shape, definition.branches.length + 1, seed, definition.variation, growth.leaves, sway);
  const skeleton = { branches, leaves };
  writeTrunkSway(wood, trunkHeight(skeleton));
  writeTrunkSway(leafBuffers, trunkHeight(skeleton));
  return { seed, skeleton, wood, leaves: leafBuffers, growth };
}

/**
 * Height of the tallest (possibly Sculpted) Stem: the scale of a tree's Wind sway. For an upright
 * trunk that is its tip. A Sculpt may delete every Stem (an empty tree, nothing sways); it is then 1.
 */
export function trunkHeight(skeleton: Pick<TreeSkeleton, 'branches'>): number {
  const stems = skeleton.branches.filter((b) => b.parent === null);
  if (stems.length === 0) return 1;
  return Math.max(...stems.flatMap((stem) => stem.points.map((p) => p.position[1])));
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
  for (const name of Object.keys(geometry.attributes).sort()) {
    arrays.push(geometry.attributes[name]!.array);
  }
  for (const array of arrays) {
    if (array) h = hashBytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), h);
  }
  return h!;
}

const hex = (h: number) => h.toString(16).padStart(8, '0');
