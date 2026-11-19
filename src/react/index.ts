// @casmo/tree.js/react: React Three Fiber bindings. Needs react and @react-three/fiber (optional peers).
// The core entry never imports this, so vanilla users don't need react installed.
export { Tree, type TreeProps } from './Tree';
export { Wind, useWindBurst, type WindProps } from './Wind';
export type { WindBurstOptions } from '../wind';
export { useTreeStyle, preloadTreeStyle } from './useTreeStyle';
export type { StyleName } from '../styles/registry';
export { Forest, type ForestProps, type ForestTreePlacement } from './Forest';
export { ScenePipeline, TreeEffect, useScenePipeline, preloadScenePipeline, type ScenePipelineProps, type TreeEffectProps } from './ScenePipeline';
export type { CustomTreeEffect } from '../effects';
export { SceneShaderHooks, type SceneShaderHooksProps } from './SceneShaderHooks';
export type { TreeShaderHook, TreeShaderHooks, TreeShaderInput, TreeShaderOutput } from '../materials/shader-hooks';
export { SnowCover, Wetness, preloadWeather, type SnowCoverProps, type WetnessProps } from './Weather';
