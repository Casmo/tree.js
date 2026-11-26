import type { StyleName } from '../styles/registry';
import type { TreeColorGradeOptions } from './grade';
import type { LeafGlowOptions } from './glow';
import type { TreeHighlightOptions } from './highlight';
import type { TreeOutlineOptions } from './outline';
import type { InnerLinesOptions } from './inner-lines';

/** A combination of Tree Effects; leave an effect out to skip it. `{}` = no effects. */
export interface TreeEffectsSettings {
  grade?: TreeColorGradeOptions;
  glow?: LeafGlowOptions;
  outline?: TreeOutlineOptions;
  innerLines?: InnerLinesOptions;
  /** Marks the TreeEffects' `highlighted` trees; never in a suggestion. */
  highlight?: TreeHighlightOptions;
}

/** The suggested combination of Tree Effects for each built-in Style. */
export const SUGGESTED_TREE_EFFECTS: Record<StyleName, TreeEffectsSettings> = {
  // Crisp facets: a dark ink line around and between the trees, ink lines on the clumps inside the
  // crown and slightly punchier colours.
  'low-poly': {
    grade: { saturation: 1.15, contrast: 1.1 },
    innerLines: { color: '#18230f', thickness: 1, strength: 0.8 },
    outline: { color: '#18230f', thickness: 2, strength: 0.9, betweenTrees: true },
  },
  // Storybook look: soft glowing foliage, a warm tint, a hint of ink inside the crown and a soft
  // coloured outline.
  stylized: {
    grade: { saturation: 0.95, contrast: 1.08, tint: '#fff1e0' },
    glow: { color: '#fff6c8', intensity: 0.45, threshold: 0.3, radius: 8 },
    innerLines: { color: '#2b3a1c', thickness: 1, strength: 0.45, normalThreshold: 0.5 },
    outline: { color: '#2b3a1c', thickness: 2, strength: 0.6 },
  },
  // Natural: no ink; only a gentle grade (warmer, a touch more contrast) and a faint sunlit leaf glow.
  realistic: {
    grade: { exposure: 1.05, contrast: 1.08, saturation: 0.95, tint: '#fff5e6' },
    glow: { color: '#e8ffc0', intensity: 0.35, threshold: 0.12, radius: 4 },
  },
  // Complete in its own materials (ADR 0014): no post. Only a gentle warm grade.
  painterly: {
    grade: { contrast: 1.04, tint: '#fff6e8' },
  },
  // Cartoon candy: a coloured (plum) outline instead of black ink, soft Inner Lines on the pom-poms and a
  // saturation boost. No Leaf Glow: the rim light already brightens the edges.
  whimsical: {
    grade: { saturation: 1.25, contrast: 1.05 },
    innerLines: { color: '#6a3a7a', thickness: 1, strength: 0.35, normalThreshold: 0.5 },
    outline: { color: '#7a3d8f', thickness: 2, strength: 0.75 },
  },
  // Night magic: no ink (it would cut the glow), a teal Leaf Glow over the glowing crowns and a cool
  // blue-violet grade.
  enchanted: {
    grade: { saturation: 1.1, contrast: 1.08, tint: '#d8d4ff' },
    glow: { color: '#7ff5e0', intensity: 0.7, threshold: 0.08, radius: 8 },
  },
};
