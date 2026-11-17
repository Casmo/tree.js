import { parseDefinition, type TreeDefinition, type TreeDefinitionInput } from '../definition';
import { Forest, type ForestOptions } from './Forest';
import type { ForestPlacement } from './placement';

export { Forest, ForestTree, ForestVariant, type ForestOptions, type ForestInstanceState } from './Forest';
export type { ForestPlacement, ForestTreeTraits } from './placement';

/**
 * Places many trees of one Tree Definition cheaply: `variants` Seeds are generated once and each
 * is drawn instanced. Each tree's Variant and small Growth/Season offsets come from a hash of
 * the forest `seed` and the tree's id (or position), so the same seed and placements always give
 * the same forest, and adding or removing a tree never changes the others.
 * Throws `TreeDefinitionError` for an invalid Definition.
 */
export function createForest(
  definition: TreeDefinitionInput | TreeDefinition,
  placements: readonly ForestPlacement[] = [],
  options: ForestOptions = {},
): Forest {
  return new Forest(parseDefinition(definition), placements, options);
}
