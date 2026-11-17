import type { StyleName } from '../styles/registry';
import type { TreeColorGradeOptions } from './grade';
import type { LeafGlowOptions } from './glow';
import type { TreeOutlineOptions } from './outline';

/** A combination of Tree Effects; leave an effect out to skip it. `{}` = no effects. */
export interface TreeEffectsPreset {
  grade?: TreeColorGradeOptions;
  glow?: LeafGlowOptions;
  outline?: TreeOutlineOptions;
}

/** The suggested combination of Tree Effects for each built-in Style. */
export const TREE_EFFECT_PRESETS: Record<StyleName, TreeEffectsPreset> = {
  // Crisp facets: a dark ink line and slightly punchier colours.
  'low-poly': {
    grade: { saturation: 1.15, contrast: 1.1 },
    outline: { color: '#18230f', thickness: 1.5, strength: 0.9 },
  },
  // Storybook look: soft glowing foliage, a warm tint and a soft coloured outline.
  stylized: {
    grade: { saturation: 1.2, tint: '#fff1e0' },
    glow: { color: '#fff6c8', intensity: 0.55, radius: 6 },
    outline: { color: '#2b3a1c', thickness: 2, strength: 0.6 },
  },
  // Natural: only a gentle grade (warmer, a touch more contrast) and a faint sunlit leaf glow.
  realistic: {
    grade: { exposure: 1.05, contrast: 1.08, saturation: 0.95, tint: '#fff5e6' },
    glow: { color: '#e8ffc0', intensity: 0.2, radius: 4 },
  },
};
