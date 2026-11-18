import type { StyleName } from '../styles/registry';
import type { TreeColorGradeOptions } from './grade';
import type { LeafGlowOptions } from './glow';
import type { TreeHighlightOptions } from './highlight';
import type { TreeOutlineOptions } from './outline';

/** A combination of Tree Effects; leave an effect out to skip it. `{}` = no effects. */
export interface TreeEffectsSettings {
  grade?: TreeColorGradeOptions;
  glow?: LeafGlowOptions;
  outline?: TreeOutlineOptions;
  /** Marks the TreeEffects' `highlighted` trees; never in a suggestion. */
  highlight?: TreeHighlightOptions;
}

/** The suggested combination of Tree Effects for each built-in Style. */
export const SUGGESTED_TREE_EFFECTS: Record<StyleName, TreeEffectsSettings> = {
  // Crisp facets: a dark ink line and slightly punchier colours.
  'low-poly': {
    grade: { saturation: 1.15, contrast: 1.1 },
    outline: { color: '#18230f', thickness: 2, strength: 0.9 },
  },
  // Storybook look: soft glowing foliage, a warm tint and a soft coloured outline.
  stylized: {
    grade: { saturation: 0.95, contrast: 1.08, tint: '#fff1e0' },
    glow: { color: '#fff6c8', intensity: 0.45, threshold: 0.3, radius: 8 },
    outline: { color: '#2b3a1c', thickness: 2, strength: 0.6 },
  },
  // Natural: only a gentle grade (warmer, a touch more contrast) and a faint sunlit leaf glow.
  realistic: {
    grade: { exposure: 1.05, contrast: 1.08, saturation: 0.95, tint: '#fff5e6' },
    glow: { color: '#e8ffc0', intensity: 0.35, threshold: 0.12, radius: 4 },
  },
};
