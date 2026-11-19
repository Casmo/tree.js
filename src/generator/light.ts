import { extendDefinition, type DefinitionPatch, type TreeDefinition } from '../definition';
import { COARSE_SIDES } from './fruit';
import { rootSides } from './roots';
import { FLARE_SECTIONS } from './trunk';

/** Fewest sides around a part of the Light level (a triangle). */
const MIN_SIDES = 3;
/** Fewest sections along a part of the Light level. */
const MIN_SECTIONS = 1;

/** Most the leaves of the Light level grow, as a multiple of their size, to fill the crown of a dropped branch level. */
const MAX_LEAF_GROWTH = 2.5;

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
 * - coarse Fruit (at most {@link COARSE_SIDES} sides).
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
    ...(fruit ? { fruit: { ...fruit, sides: Math.min(fruit.sides ?? COARSE_SIDES, COARSE_SIDES) } } : {}),
    ...(roots ? { roots: { ...roots, sides: halfSides(rootSides(definition)) } } : {}),
  };
  return extendDefinition(derived, override);
}
