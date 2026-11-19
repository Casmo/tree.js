// Weather (`@casmo/tree.js/weather`): opt-in ready-made Tree Shader Hooks with scene-wide amounts (ADR 0012).
// Games without weather never import this entry, so it costs them nothing.
export {
  sceneWetness,
  Wetness,
  wetnessHooks,
  type WetnessHooks,
  type WetnessLook,
  type WetnessOptions,
  type WetnessSettings,
} from './wetness';
export { Snow, sceneSnow, SnowCover, type SnowOptions, type SnowCoverOptions, type SnowStrength, snowCoverShading, type SnowCoverShadingSettings } from './snow';
