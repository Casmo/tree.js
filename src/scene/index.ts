// Scene Pipeline (`@casmo/tree.js/scene`): opt-in Scene Effects around the trees, with the Tree Effects.
// Depends on ./effects, never the other way round.
export {
  createScenePipeline,
  ScenePipeline,
  type ScenePipelineChoice,
  type ScenePipelineOptions,
  type ScenePipelineSettings,
} from './pipeline';
export { sceneAntialias, type SceneAntialiasInput, type SceneAntialiasMode } from './antialias';
export { type SceneEffectsChoice, type SceneEffectsSettings } from './settings';
export { sceneAO, type SceneAO, type SceneAOOptions } from './ao';
export { sceneBloom, type SceneBloomOptions } from './bloom';
export { sceneMotionBlur, type SceneMotionBlurOptions } from './motion-blur';
export { SUGGESTED_SCENE_EFFECTS } from './suggested';
export { applySceneEffects } from './stack';
export { type SceneEffectInput } from './stage';
export { sceneFog, type SceneFogOptions, type SceneMistFarLayerOptions, type SceneMistOptions } from './fog';
export { sceneToneMapping, type SceneToneMappingCurve, type SceneToneMappingOptions } from './tone-mapping';
export { sceneGodrays, type SceneGodraysOptions, type SceneGodraysSun } from './godrays';
export { windVelocity, windVelocityMRT, WIND_VELOCITY, type ScenePass } from './velocity';
