// Which Tree Effects the preview shows: a toggle per effect, with the settings of a Style's
// suggested combination (SUGGESTED_TREE_EFFECTS). Pure logic; the panel and preview wiring live in
// panels/effects-panel.ts and effects-preview.ts.
import type { StyleName } from '@casmo/tree.js';
import { SUGGESTED_TREE_EFFECTS, type TreeEffectsSettings } from '@casmo/tree.js/effects';
import { parseStartId } from './starts';

/** The Tree Effects, in the order they are applied. */
export const EFFECT_NAMES = ['grade', 'glow', 'innerLines', 'outline'] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];

export const EFFECT_LABELS: Record<EffectName, string> = {
  grade: 'Colour grade',
  glow: 'Leaf glow',
  innerLines: 'Inner lines',
  outline: 'Outline',
};

/** Which effects are switched on. */
export type EffectToggles = Record<EffectName, boolean>;

export const NO_EFFECTS: EffectToggles = { grade: false, glow: false, innerLines: false, outline: false };

/** The Style of a starting point id ("oak/realistic", old "low-poly/conifer"), or null (imported JSON, unknown Style). */
export function styleOfSource(source: string): StyleName | null {
  return parseStartId(source)?.style ?? null;
}

/** The toggles of a Style's suggested combination. */
export function suggestedEffects(style: StyleName): EffectToggles {
  const settings = SUGGESTED_TREE_EFFECTS[style];
  return { grade: !!settings.grade, glow: !!settings.glow, innerLines: !!settings.innerLines, outline: !!settings.outline };
}

/**
 * The combination to render: the switched-on effects with the Style's settings (an effect's own
 * defaults where the Style does not suggest it). Null when every effect is off.
 */
export function effectsSettings(style: StyleName, toggles: EffectToggles): TreeEffectsSettings | null {
  const suggested = SUGGESTED_TREE_EFFECTS[style];
  const settings: TreeEffectsSettings = {};
  for (const name of EFFECT_NAMES) {
    if (toggles[name]) Object.assign(settings, { [name]: suggested[name] ?? {} });
  }
  return Object.keys(settings).length > 0 ? settings : null;
}
