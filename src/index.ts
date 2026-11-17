// Core entry point of @casmo/tree.js.
export { createTree, Tree, type CreateTreeOptions, type TreeOptions } from './tree';
export * from './definition';
export {
  generateTree,
  hashGeometry,
  hashTreeData,
  type TreeData,
  type GrowthTiming,
  type GrowthWindow,
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
export { growPositions, growthPosition, SAPLING_SCALE, SAPLING_THICKNESS } from './growth';
export { assertWebGPURenderer, UnsupportedRendererError } from './renderer';
