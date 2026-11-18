import type { TreeDefinition } from '../definition';
import { createRandom, hashBytes, seedRandom } from '../random';
import { woodSeasonAttribute } from '../season/profile';
import { buildBranches } from './branches';
import { fruitGeometry, fruitGrowth, placeFruit } from './fruit';
import { growthTiming } from './growth';
import { solidLeafGeometry } from './leaf-shapes';
import { leafGeometry, placeLeaves } from './leaves';
import { mergeBuffers, sweepBranch } from './mesh';
import { sculptBranches, sculptLeaves, sculptsFor } from './sculpt';
import { buildTrunk } from './trunk';
import { branchSway, writeTrunkSway } from './wind';
import type { GeometryBuffers, TreeData, TreeSkeleton } from './types';

export { growthTiming } from './growth';
export type { GrowthTiming, GrowthWindow, GeometryBuffers, TreeAttributes, VertexAttribute, SkeletonBranch, SkeletonFruit, SkeletonLeaf, SkeletonPoint, TreeData, TreeSkeleton, Vec3 } from './types';

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
  const sculpts = sculptsFor(definition, seed);
  const branches = sculptBranches([trunk, ...buildBranches(definition, trunk, random.fork('branches'))], sculpts);
  const sidesOf = (level: number) => (level === 0 ? definition.trunk.sides : definition.branches[level - 1]!.sides);
  const leaves = sculptLeaves(placeLeaves(definition, branches, random.fork('leaves')), sculpts, seed);
  const fruit = placeFruit(definition, branches, random.fork('fruit'));
  const partGrowth = growthTiming(definition, seed, branches, leaves);
  const growth = {
    ...partGrowth,
    fruit: fruitGrowth(seed, fruit, new Map(branches.map((b, i) => [b.path, partGrowth.branches[i]!]))),
  };
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
  const fruitBuffers = fruitGeometry(
    fruit,
    definition.fruit?.type ?? 'round',
    definition.branches.length + 2,
    seed,
    definition.variation,
    growth.fruit,
    sway,
  );
  const skeleton = { branches, leaves, fruit };
  writeTrunkSway(wood, trunkHeight(skeleton));
  writeTrunkSway(leafBuffers, trunkHeight(skeleton));
  writeTrunkSway(fruitBuffers, trunkHeight(skeleton));
  return { seed, skeleton, wood, leaves: leafBuffers, fruit: fruitBuffers, growth };
}

/**
 * Height of the (possibly Sculpted) trunk's tip: the scale of a tree's Wind sway. A Sculpt may
 * delete the trunk (an empty tree, nothing sways); the height is then 1.
 */
export function trunkHeight(skeleton: Pick<TreeSkeleton, 'branches'>): number {
  const trunk = skeleton.branches.find((b) => b.parent === null)?.points;
  return trunk ? trunk[trunk.length - 1]!.position[1] : 1;
}

/** Stable 32-bit hash (hex) of the generated geometry buffers, for determinism checks. */
export function hashGeometry(geometry: GeometryBuffers): string {
  return hex(hashBuffers(geometry));
}

/** Stable hash of a tree's generated geometry (wood, leaves and, if any, Fruit). */
export function hashTreeData(data: TreeData): string {
  const h = hashBuffers(data.leaves, hashBuffers(data.wood));
  // A tree without Fruit hashes as before Fruit existed.
  return hex(data.fruit.positions.length > 0 ? hashBuffers(data.fruit, h) : h);
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
