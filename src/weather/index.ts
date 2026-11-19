// Weather (`@casmo/tree.js/weather`): ready-made Tree Shader Hooks driven by scene-wide amounts. Opt-in:
// the core entry never imports this, so a game without weather never loads it (ADR 0008, ADR 0012).
export { Snow, sceneSnow, SnowCover, type SnowOptions, type SnowCoverOptions, type SnowStrength, snowCoverShading, type SnowCoverShadingSettings } from './snow';
