import type { TreeDefinition } from '../definition';
import { createRandom, hashBytes, seedRandom } from '../random';
import { woodSeasonAttribute } from '../season/profile';
import { buildBranches } from './branches';
import { crownVolume } from './crown';
import { fruitGeometry, fruitGrowth, placeFruit } from './fruit';
import { growthTiming } from './growth';
import { shapedLeafGeometry } from './leaf-shapes';
import { placeLeaves } from './leaves';
import { mergeBuffers, sweepBranch } from './mesh';
import { bakeOcclusion } from './occlusion';
import { growRoots, rootSides } from './roots';
import { sculptBranches, sculptLeaves, sculptsFor } from './sculpt';
import { buildStems, FLARE_SECTIONS } from './trunk';
import type { CorkscrewAlong } from './twist';
import { branchSway, writeTrunkSway } from './wind';
import type { GeometryBuffers, TreeData, TreeSkeleton } from './types';

export { growthTiming } from './growth';
export { generateLightTree, lightDefinition } from './light';
export { crownDistance, crownNormal, type CrownVolume } from './crown';
export type { GrowthTiming, GrowthWindow, GeometryBuffers, TreeAttributes, VertexAttribute, SkeletonBranch, SkeletonFruit, SkeletonRoot, SkeletonLeaf, SkeletonPoint, TreeData, TreeSkeleton, Vec3 } from './types';

/**
 * The Generator: a pure function from a (parsed) Tree Definition and a Seed to tree data.
 * No three.js, no GPU, no globals; runs in Node. Same input, same output, on every machine.
 *
 * Each part of the tree draws from its own `random.fork(<part>)` stream so that adding
 * a new part never shifts the numbers of an existing one.
 */
export function generateTree(definition: TreeDefinition, seed: number): TreeData {
  const random = createRandom(seed);
  const corkscrews = new Map<string, CorkscrewAlong>();
  const stems = buildStems(definition, random, corkscrews);
  const sculpts = sculptsFor(definition, seed);
  const branches = sculptBranches([...stems, ...buildBranches(definition, stems, random.fork('branches'), corkscrews)], sculpts);
  const sidesOf = (level: number) => (level === 0 ? definition.trunk.sides : definition.branches[level - 1]!.sides);
  const leaves = sculptLeaves(placeLeaves(definition, branches, random.fork('leaves')), sculpts, seed);
  const fruit = placeFruit(definition, branches, random.fork('fruit'));
  // Roots grow from the Stems the Sculpt pass left, as it left them (ADR 0007).
  const roots = growRoots(
    definition,
    branches.filter((b) => b.parent === null),
    random,
  );
  const partGrowth = growthTiming(definition, seed, branches, leaves);
  const growth = {
    ...partGrowth,
    fruit: fruitGrowth(seed, fruit, new Map(branches.map((b, i) => [b.path, partGrowth.branches[i]!]))),
    // Like the trunk: there from Growth 0, scaled with the whole tree.
    roots: roots.map(() => ({ start: 0, end: 0 })),
  };
  const stemSweep = { flare: definition.trunk.flare ?? 0, sections: definition.trunk.flareSections ?? FLARE_SECTIONS };
  const sway = branchSway(branches, definition.branches.length);
  const woodSeason = woodSeasonAttribute(seed, definition.variation);
  // Roots come after every branch, so the rest of the wood buffer is the same with or without them.
  // They get no branch sway and no flutter.
  const wood = mergeBuffers([
    ...branches.map((b, i) =>
      sweepBranch(
        b,
        sidesOf(b.level),
        seedRandom(seed, b.path),
        woodSeason,
        growth.branches[i],
        sway.get(b.path),
        b.parent === null ? stemSweep : undefined,
      ),
    ),
    ...roots.map((root, i) => sweepBranch(root, rootSides(definition), seedRandom(seed, root.path), woodSeason, growth.roots[i])),
  ]);
  const leafBuffers = shapedLeafGeometry(leaves, definition.leaves, definition.branches.length + 1, seed, definition.variation, growth.leaves, sway);
  const fruitBuffers = fruitGeometry(
    fruit,
    definition.fruit ?? { type: 'round' },
    definition.branches.length + 2,
    seed,
    definition.variation,
    growth.fruit,
    sway,
  );
  const skeleton = { branches, leaves, fruit, roots };
  writeTrunkSway(wood, trunkHeight(skeleton));
  writeTrunkSway(leafBuffers, trunkHeight(skeleton));
  writeTrunkSway(fruitBuffers, trunkHeight(skeleton));
  // The Crown Volume sits next to the geometry, not in it: the buffers and their hash are unchanged.
  const crown = crownVolume(leafBuffers.positions, branches);
  // Structural Occlusion (ADR 0008): only with `materials.occlusion`, so without it the buffers are as before.
  if (definition.materials.occlusion) bakeOcclusion([wood, leafBuffers, fruitBuffers], leafBuffers, crown);
  return { seed, skeleton, wood, leaves: leafBuffers, fruit: fruitBuffers, growth, crown };
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
