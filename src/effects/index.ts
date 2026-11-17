// Tree Effects (`@casmo/tree.js/effects`): opt-in TSL post-processing that only changes tree pixels.
export { TREE_MASK, treeMask, treeMaskMRT, treeEffectsPass, treePartOf, type TreeEffectInput, type TreeEffectsPass, type TreePart } from './mask';
export { treeOutline, type TreeOutlineOptions, type TreeOutlineTarget } from './outline';
export { leafGlow, type LeafGlowOptions } from './glow';
export { treeColorGrade, type TreeColorGradeOptions } from './grade';
export { TREE_EFFECT_PRESETS, type TreeEffectsPreset } from './presets';
export {
  applyTreeEffects,
  createTreeEffects,
  findTreeMeshes,
  TreeEffects,
  type TreeEffectsChoice,
  type TreeEffectsOptions,
} from './effects';
