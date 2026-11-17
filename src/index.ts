// Core entry point of @casmo/tree.js.
export { createTree, Tree, type CreateTreeOptions, type TreeOptions } from './tree';
export * from './definition';
export * from './season';
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
export {
  DEFAULT_TEXTURE_BASE_PATH,
  getTextureOptions,
  loadTexture,
  resolveTextureUrl,
  setTextureOptions,
  textureReady,
  type TextureKind,
  type TextureOptions,
} from './textures';
export { assertWebGPURenderer, UnsupportedRendererError } from './renderer';
export { Wind, sceneWind, WindResponse, windOffset, applyWind, type WindDirection, type WindOptions } from './wind';
export type { TreeStyle } from './styles/types';
export { loadStyle, STYLE_NAMES, type StyleName } from './styles/registry';
export {
  bakeTree,
  disposeBakedTree,
  exportBakedTree,
  type BakeOptions,
  type ExportBakedTreeOptions,
} from './bake';
