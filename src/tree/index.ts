import { parseDefinition, type TreeDefinition, type TreeDefinitionInput } from '../definition';
import { generateTree } from '../generator';
import { Tree } from './Tree';

export { Tree, type TreeOptions } from './Tree';

export interface CreateTreeOptions {
  /** Picks one individual tree within the Definition's ranges. Default 0. */
  seed?: number;
  /** Starting Growth, 0 (sapling) .. 1 (fully grown, default). Change it later with `tree.growth`. */
  growth?: number;
}

/**
 * Grows a tree from a Tree Definition (plain object or parsed JSON) and a Seed and
 * returns a three.js object to add to a scene rendered by `WebGPURenderer`.
 * Throws `TreeDefinitionError` for an invalid Definition.
 */
export function createTree(
  definition: TreeDefinitionInput | TreeDefinition,
  options: CreateTreeOptions = {},
): Tree {
  const parsed = parseDefinition(definition);
  const seed = options.seed ?? 0;
  return new Tree(parsed, generateTree(parsed, seed), { growth: options.growth });
}
