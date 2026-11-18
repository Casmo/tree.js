// Tree Effects (`@casmo/tree.js/effects`): opt-in TSL post-processing that only changes tree pixels.
export { TREE_MASK, createTreeMask, treeMaskMRT, treeEffectsPass, treePartOf, type TreeEffectInput, type TreeEffectsPass, type TreePart } from './mask';
export { treeOutline, type TreeOutlineOptions } from './outline';
export { leafGlow, type LeafGlowOptions } from './glow';
export { treeColorGrade, type TreeColorGradeOptions } from './grade';
export { TREE_ID, readTreeId, treeFromId, treeIdMRT, treeIdOf, treeIdTexture } from './tree-id';
export { SUGGESTED_TREE_EFFECTS, type TreeEffectsSettings } from './suggested';
export {
  applyTreeEffects,
  createTreeEffects,
  TreeEffects,
  type TreeEffectsChoice,
  type TreeEffectsOptions,
} from './effects';
