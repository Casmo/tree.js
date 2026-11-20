import { extendDefinition, type DefinitionPatch, type TreeDefinition } from '../definition';
import { createRandom, seedRandom } from '../random';
import { woodSeasonAttribute } from '../season/profile';
import { buildBranches } from './branches';
import { crownVolume } from './crown';
import { COARSE_SIDES, emptyGeometry, fruitGeometry, fruitGrowth, placeFruit } from './fruit';
import { growthTiming } from './growth';
import { trunkHeight } from './index';
import { shapedLeafGeometry } from './leaf-shapes';
import { placeLeaves } from './leaves';
import { mergeBuffers, sweepBranch } from './mesh';
import { bakeOcclusion } from './occlusion';
import { growRoots, rootSides } from './roots';
import { sculptBranches, sculptLeaves, sculptsFor } from './sculpt';
import { buildStems, FLARE_SECTIONS } from './trunk';
import type { GrowthWindow, SkeletonBranch, TreeData } from './types';
import { branchSway, writeTrunkSway } from './wind';

/** Fewest sides around a part of the Light level (a triangle). */
const MIN_SIDES = 3;
/** Fewest sections along a part of the Light level. */
const MIN_SECTIONS = 1;

/** Most the leaves of the Light level grow, as a multiple of their size, to fill the crown of a dropped branch level. */
const MAX_LEAF_GROWTH = 2.5;
/** The share of the Full tree's Fruit the Light level keeps (each Fruit by its own stable random number). */
const LIGHT_FRUIT_SHARE = 0.5;

const halfSides = (sides: number) => Math.max(MIN_SIDES, Math.round(sides / 2));
const halfSections = (sections: number) => Math.max(MIN_SECTIONS, Math.round(sections / 2));

/**
 * The Light Definition (ADR 0010): the Definition a Forest's Light Detail Level is generated from.
 * Fixed reductions of `definition`:
 * - about half the sides and sections of the trunk and every branch level (at least 3 sides, 1 section),
 *   half the sides of the Roots and half the extra rings of the Root Flare;
 * - the deepest branch level dropped (when there are at least two and it has branches), and the leaves
 *   then grow on the level above, larger by the square root of the dropped level's `count` (at most
 *   {@link MAX_LEAF_GROWTH} times) to keep the crown filled;
 * - with a single branch level kept: half the leaves per branch, larger to keep the same leaf area;
 * - coarse Fruit: half the sides, at most {@link COARSE_SIDES} (at least 3).
 *
 * Then `override` is merged on top (like {@link extendDefinition}: objects deeply, arrays replace) and the
 * result is validated. Pure and deterministic; never mutates `definition`.
 */
export function lightDefinition(definition: TreeDefinition, override: DefinitionPatch = {}): TreeDefinition {
  const { trunk, branches, leaves, fruit, roots } = definition;
  const deepest = branches[branches.length - 1];
  const drop = branches.length >= 2 && deepest!.count > 0;
  const halved = drop ? leaves.count : Math.max(1, Math.round(leaves.count / 2));
  const growth = drop ? Math.min(Math.sqrt(deepest!.count), MAX_LEAF_GROWTH) : leaves.count > 0 ? Math.sqrt(leaves.count / halved) : 1;

  const derived: TreeDefinition = {
    ...definition,
    trunk: {
      ...trunk,
      sides: halfSides(trunk.sides),
      sections: halfSections(trunk.sections),
      ...(trunk.flare ? { flareSections: halfSections(trunk.flareSections ?? FLARE_SECTIONS) } : {}),
    },
    branches: (drop ? branches.slice(0, -1) : branches).map((level) => ({
      ...level,
      sides: halfSides(level.sides),
      sections: halfSections(level.sections),
    })),
    leaves: leaves.count > 0 ? { ...leaves, count: halved, size: leaves.size * growth } : leaves,
    ...(fruit ? { fruit: { ...fruit, sides: Math.min(halfSides(fruit.sides ?? 2 * COARSE_SIDES), COARSE_SIDES) } } : {}),
    ...(roots ? { roots: { ...roots, sides: halfSides(rootSides(definition)) } } : {}),
  };
  return extendDefinition(derived, override);
}

/**
 * The Light Detail Level of a Variant (ADR 0010): the tree of `definition` and `seed`, generated from its
 * {@link lightDefinition} (with `override`) so that it keeps every surviving branch in place:
 *
 * - the skeleton grows with the Full Definition's sections (branch paths fork their randomness, ADR 0003,
 *   so every branch the Light level keeps lies exactly where it does in the Full tree); the wood mesh then
 *   sweeps only every other skeleton point (the Light sections) with the Light sides;
 * - leaves grow on the outermost Light branches, and only where the Full tree has leaves on that branch
 *   or the branches growing from it (Sculpts deleting branches or painting leaves carry over);
 * - about half the Full tree's Fruit (each kept or not by its own stable random number) hangs where it
 *   hangs in Full, drawn coarse (a Fruit that is already coarse cannot get fewer faces otherwise).
 *
 * Growth, Wind and Season attributes are those of the Full tree: a surviving branch (and its Fruit) grows,
 * sways and changes with the Season exactly as in Full; a Light leaf grows from the first to the last Full
 * leaf on its branch. Leaves and Fruit keep the Full `aLevel`. With `materials.occlusion` the meshes carry
 * `aOcclusion` like Full, so the Light meshes can share the Variant's materials. Pure and deterministic.
 */
export function generateLightTree(definition: TreeDefinition, seed: number, override?: DefinitionPatch): TreeData {
  const light = lightDefinition(definition, override);
  const random = createRandom(seed);

  // The Full skeleton (no meshes): its Growth, Wind sway, leaf spans and Fruit.
  const fullSculpts = sculptsFor(definition, seed);
  const fullStems = buildStems(definition, random);
  const fullBranches = sculptBranches([...fullStems, ...buildBranches(definition, fullStems, random.fork('branches'))], fullSculpts);
  const fullLeaves = sculptLeaves(placeLeaves(definition, fullBranches, random.fork('leaves')), fullSculpts, seed);
  const fullTiming = growthTiming(definition, seed, fullBranches, fullLeaves);
  const fullGrowth = new Map(fullBranches.map((b, i) => [b.path, fullTiming.branches[i]!]));
  const fullFruit = placeFruit(definition, fullBranches, random.fork('fruit'));
  const fullFruitGrowth = fruitGrowth(seed, fullFruit, fullGrowth);
  const kept = fullFruit.map((f) => seedRandom(seed, `light/fruit/${f.id}`) < LIGHT_FRUIT_SHARE);
  const fruit = fullFruit.filter((_, i) => kept[i]);

  // Each branch's span of Full leaf Growth (over the leaves on it and on the branches growing from it).
  const leafSpan = new Map<string, GrowthWindow>();
  fullLeaves.forEach((leaf, l) => {
    const window = fullTiming.leaves[l]!;
    const parts = leaf.branch.split('.');
    for (let n = 1; n <= parts.length; n++) {
      const path = parts.slice(0, n).join('.');
      const span = leafSpan.get(path);
      leafSpan.set(path, span ? { start: Math.min(span.start, window.start), end: Math.max(span.end, window.end) } : window);
    }
  });

  // The Light skeleton: the Light shape grown on the Full sections.
  const shape: TreeDefinition = {
    ...light,
    trunk: { ...light.trunk, sections: definition.trunk.sections },
    branches: light.branches.map((level, i) => ({ ...level, sections: definition.branches[i]?.sections ?? level.sections })),
  };
  const sculpts = sculptsFor(shape, seed);
  const stems = buildStems(shape, random);
  const branches = sculptBranches([...stems, ...buildBranches(shape, stems, random.fork('branches'))], sculpts);
  const leaves = sculptLeaves(placeLeaves(light, branches, random.fork('leaves')), sculpts, seed).filter((leaf) => leafSpan.has(leaf.branch));
  const roots = growRoots(
    light,
    branches.filter((b) => b.parent === null),
    random,
  );

  // Growth and Wind of the Full tree; a branch only an override adds gets its own.
  const own = growthTiming(light, seed, branches, []);
  const growth = {
    branches: branches.map((b, i) => fullGrowth.get(b.path) ?? own.branches[i]!),
    leaves: leaves.map((leaf) => leafSpan.get(leaf.branch)!),
    fruit: fullFruitGrowth.filter((_, i) => kept[i]),
    roots: roots.map(() => ({ start: 0, end: 0 })),
  };
  const sway = new Map([...branchSway(branches, light.branches.length), ...branchSway(fullBranches, definition.branches.length)]);

  const sidesOf = (level: number) => (level === 0 ? light.trunk.sides : light.branches[level - 1]!.sides);
  const sectionsOf = (level: number) => (level === 0 ? light.trunk.sections : light.branches[level - 1]!.sections);
  const stemSweep = { flare: light.trunk.flare ?? 0, sections: light.trunk.flareSections ?? FLARE_SECTIONS };
  const woodSeason = woodSeasonAttribute(seed, definition.variation);
  const wood = mergeBuffers([
    ...branches.map((b, i) =>
      sweepBranch(
        coarsen(b, sectionsOf(b.level)),
        sidesOf(b.level),
        seedRandom(seed, b.path),
        woodSeason,
        growth.branches[i],
        sway.get(b.path),
        b.parent === null ? stemSweep : undefined,
      ),
    ),
    ...roots.map((root, i) => sweepBranch(root, rootSides(light), seedRandom(seed, root.path), woodSeason, growth.roots[i])),
  ]);
  const leafLevel = definition.branches.length + 1;
  const leafBuffers = shapedLeafGeometry(leaves, light.leaves, leafLevel, seed, definition.variation, growth.leaves, sway);
  const fruitBuffers = light.fruit
    ? fruitGeometry(fruit, light.fruit, definition.branches.length + 2, seed, definition.variation, growth.fruit, sway)
    : emptyGeometry();
  const skeleton = { branches, leaves, fruit, roots };
  const height = trunkHeight(skeleton);
  for (const buffers of [wood, leafBuffers, fruitBuffers]) writeTrunkSway(buffers, height);
  const crown = crownVolume(leafBuffers.positions, branches);
  if (definition.materials.occlusion) bakeOcclusion([wood, leafBuffers, fruitBuffers], leafBuffers, crown);
  return { seed, skeleton, wood, leaves: leafBuffers, fruit: fruitBuffers, growth, crown };
}

/** The branch with only `sections` + 1 of its skeleton points (evenly picked, both ends kept) to sweep. */
function coarsen(branch: SkeletonBranch, sections: number): SkeletonBranch {
  const n = branch.points.length - 1;
  if (sections >= n) return branch;
  return { ...branch, points: Array.from({ length: sections + 1 }, (_, k) => branch.points[Math.round((k * n) / sections)]!) };
}
