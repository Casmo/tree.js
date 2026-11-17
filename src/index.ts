// Core entry point of @casmo/tree.js.
export { createTree, Tree, type CreateTreeOptions } from './tree';
export {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DEFINITION,
  DEFAULT_BRANCH_LEVEL,
  parseDefinition,
  TreeDefinitionError,
  type TreeDefinition,
  type TreeDefinitionInput,
  type TrunkDefinition,
  type BarkDefinition,
  type BranchLevelDefinition,
  type LeavesDefinition,
} from './definition';
export {
  generateTree,
  hashGeometry,
  hashTreeData,
  type TreeData,
  type TreeSkeleton,
  type SkeletonBranch,
  type SkeletonPoint,
  type SkeletonLeaf,
  type GeometryBuffers,
  type TreeAttributes,
  type VertexAttribute,
  type Vec3,
} from './generator';
export { createRandom, hashString, hashCombine, type Random } from './random';
export { createBarkMaterial, createLeafMaterial } from './materials';
export { assertWebGPURenderer, UnsupportedRendererError } from './renderer';
