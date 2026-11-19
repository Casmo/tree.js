// Scene Pipeline (`@casmo/tree.js/scene`): opt-in Scene Effects around the trees, with the Tree Effects.
// Depends on ./effects, never the other way round.
export {
  createScenePipeline,
  ScenePipeline,
  type ScenePipelineChoice,
  type ScenePipelineOptions,
  type ScenePipelineSettings,
} from './pipeline';
export { type SceneEffectsChoice, type SceneEffectsSettings } from './settings';
export { sceneAO, type SceneAO, type SceneAOOptions } from './ao';
export { SUGGESTED_SCENE_EFFECTS } from './suggested';
export { applySceneEffects } from './stack';
export { type SceneEffectInput } from './stage';
export { sceneToneMapping, type SceneToneMappingCurve, type SceneToneMappingOptions } from './tone-mapping';
