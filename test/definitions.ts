// Tree Definition helpers shared by tests.
import { DEFAULT_DEFINITION } from '../src/definition';

/**
 * `definition` with Tip Branches off on every level (absent `branches` are the default levels): every parent
 * ends in a stump, the tree from before Tip Branches (ADR 0019).
 */
export const withoutTipBranches = <T extends { branches?: readonly object[] }>(definition: T): T & { branches: object[] } => ({
  ...definition,
  branches: (definition.branches ?? DEFAULT_DEFINITION.branches).map((level) => ({ ...level, tipBranches: 0 })),
});
