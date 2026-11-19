// Core entry point of @casmo/tree.js.
export { createTree, Tree, type CreateTreeOptions, type TreeOptions } from './tree';
export * from './definition';
export * from './season';
export {
  crownDistance,
  crownNormal,
  hashGeometry,
  hashTreeData,
  type CrownVolume,
  type TreeData,
  type GrowthTiming,
  type GrowthWindow,
  type TreeSkeleton,
  type SkeletonBranch,
  type SkeletonPoint,
  type SkeletonLeaf,
  type SkeletonFruit,
  type SkeletonRoot,
  type GeometryBuffers,
  type TreeAttributes,
  type VertexAttribute,
  type Vec3,
} from './generator';
export { createRandom, type Random } from './random';
export { createBarkMaterial, createLeafMaterial } from './materials';
export type { TreeShaderHook, TreeShaderHooks, TreeShaderInput, TreeShaderOutput } from './materials/shader-hooks';
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
export { Wind, sceneWind, WindResponse, type WindDirection, type WindOptions } from './wind';
export type { TreeStyle } from './styles/types';
export type { StyleSource } from './styles/apply';
export type {
  SpeciesDefinition,
  SpeciesTrunkDefinition,
  SpeciesBranchLevelDefinition,
  SpeciesFoliageDefinition,
  SpeciesBarkDefinition,
  SpeciesFruitDefinition,
  SpeciesRootsDefinition,
} from './species/types';
export { loadStyle, STYLE_NAMES, styleLabel, styleOfShading, type StyleName } from './styles/registry';
export { materialFeaturesOf, SUGGESTED_MATERIAL_FEATURES, withMaterialFeatures } from './styles/material-features';
export {
  bakeTree,
  disposeBakedTree,
  exportBakedTree,
  type BakeOptions,
  type ExportBakedTreeOptions,
  type MaterialFeatureExtras,
} from './bake';
export {
  createForest,
  Forest,
  ForestTree,
  ForestVariant,
  type ForestOptions,
  type ForestPlacement,
  type ForestInstanceState,
  type ForestTreeTraits,
  DetailLevel,
  selectDetailLevel,
  type DetailLevelSelection,
  type ForestLodOptions,
  type ForestLodSettings,
  type ForestLodUpdate,
  type ImpostorAtlasOptions,
} from './forest';
