// Which Tree Effects the preview shows: a toggle per effect, with the settings of a Style's
// suggested combination (TREE_EFFECT_PRESETS). Pure logic; the panel and preview wiring live in
// panels/effects-panel.ts and effects-preview.ts.
import { STYLE_NAMES, type StyleName } from '@casmo/tree.js';
import { TREE_EFFECT_PRESETS, type TreeEffectsPreset } from '@casmo/tree.js/effects';

/** The Tree Effects, in the order they are applied. */
export const EFFECT_NAMES = ['grade', 'glow', 'outline'] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

export const EFFECT_LABELS: Record<EffectName, string> = {
  grade: 'Colour grade',
  glow: 'Leaf glow',
  outline: 'Outline',
};

/** Which effects are switched on. */
export type EffectToggles = Record<EffectName, boolean>;

export const NO_EFFECTS: EffectToggles = { grade: false, glow: false, outline: false };

/** The Style of a starting point id ("<style>/<form>"), or null (imported JSON, unknown Style). */
export function styleOfSource(source: string): StyleName | null {
  const [style, form] = source.split('/');
  return form !== undefined && (STYLE_NAMES as string[]).includes(style!) ? (style as StyleName) : null;
}

/** The toggles of a Style's suggested combination. */
export function suggestedEffects(style: StyleName): EffectToggles {
  const preset = TREE_EFFECT_PRESETS[style];
  return { grade: !!preset.grade, glow: !!preset.glow, outline: !!preset.outline };
}

/**
 * The combination to render: the switched-on effects with the Style's settings (an effect's own
 * defaults where the Style does not suggest it). Null when every effect is off.
 */
export function effectsPreset(style: StyleName, toggles: EffectToggles): TreeEffectsPreset | null {
  const suggested = TREE_EFFECT_PRESETS[style];
  const preset: TreeEffectsPreset = {};
  for (const name of EFFECT_NAMES) {
    if (toggles[name]) Object.assign(preset, { [name]: suggested[name] ?? {} });
  }
  return Object.keys(preset).length > 0 ? preset : null;
}
