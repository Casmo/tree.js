// Pure edits of the branching levels list (`definition.branches`).
import { DEFAULT_BRANCH_LEVEL, MAX_BRANCH_LEVELS, type BranchLevelDefinition } from '@casmo/tree.js';

/** The levels plus one more below the deepest, shaped like it (or the default level on a bare trunk). */
export function addBranchLevel(branches: readonly BranchLevelDefinition[]): BranchLevelDefinition[] {
  if (branches.length >= MAX_BRANCH_LEVELS) throw new RangeError(`A tree has at most ${MAX_BRANCH_LEVELS} branching levels`);
  return [...branches, { ...(branches.at(-1) ?? DEFAULT_BRANCH_LEVEL) }].map((b) => ({ ...b }));
}

/** The levels without level `index` (the levels below it move up one). */
export function removeBranchLevel(branches: readonly BranchLevelDefinition[], index: number): BranchLevelDefinition[] {
  return branches.filter((_, i) => i !== index).map((b) => ({ ...b }));
}
