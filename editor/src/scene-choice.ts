// Which Scene Effects the preview shows: a toggle per Scene Effect plus an anti-aliasing choice, with
// the settings of a Style's suggestion (SUGGESTED_SCENE_EFFECTS). Pure logic; the panel and preview
// wiring live in panels/effects-panel.ts and effects-preview.ts.
// To add an option: add the name to SCENE_EFFECT_NAMES / ANTIALIAS_CHOICES. Motion blur and TRAA are
// offered but never part of a suggestion (suggestedScene leaves them off).
import type { StyleName } from '@casmo/tree.js';
import { SUGGESTED_SCENE_EFFECTS, type SceneAntialiasMode, type SceneEffectsSettings, type SceneFogOptions } from '@casmo/tree.js/scene';

/** The Scene Effects with an on/off toggle (anti-aliasing is a choice of its own), in panel order. */
export const SCENE_EFFECT_NAMES = ['toneMapping', 'ao', 'bloom', 'fog', 'godrays', 'motionBlur'] as const;
export type SceneEffectName = (typeof SCENE_EFFECT_NAMES)[number];

export const SCENE_EFFECT_LABELS: Record<SceneEffectName, string> = {
  toneMapping: 'Tone mapping',
  ao: 'Ambient occlusion',
  bloom: 'Bloom',
  fog: 'Fog',
  godrays: 'God rays',
  motionBlur: 'Motion blur',
};

/** The anti-aliasing choices the panel offers (`null` = off), in order. */
export const ANTIALIAS_CHOICES = [null, 'smaa', 'fxaa', 'traa'] as const satisfies readonly (SceneAntialiasMode | null)[];
export type AntialiasChoice = (typeof ANTIALIAS_CHOICES)[number];

export const ANTIALIAS_LABELS: Record<string, string> = { off: 'Off', smaa: 'SMAA', fxaa: 'FXAA', traa: 'TRAA' };

/** Which Scene Effects are on, and the anti-aliasing. */
export interface SceneChoice {
  toggles: Record<SceneEffectName, boolean>;
  antialias: AntialiasChoice;
}

export const NO_SCENE_EFFECTS: SceneChoice = {
  toggles: { toneMapping: false, ao: false, bloom: false, fog: false, godrays: false, motionBlur: false },
  antialias: null,
};

/** The choice of a Style's suggestion (TRAA and motion blur are never part of it). */
export function suggestedScene(style: StyleName): SceneChoice {
  const settings = SUGGESTED_SCENE_EFFECTS[style];
  const toggles = { ...NO_SCENE_EFFECTS.toggles };
  for (const name of SCENE_EFFECT_NAMES) toggles[name] = settings[name] !== undefined;
  const antialias = (ANTIALIAS_CHOICES as readonly unknown[]).includes(settings.antialias) ? (settings.antialias as AntialiasChoice) : null;
  return { toggles, antialias: antialias ?? null };
}

/** Whether two choices are the same. */
export function sameSceneChoice(a: SceneChoice, b: SceneChoice): boolean {
  return a.antialias === b.antialias && SCENE_EFFECT_NAMES.every((name) => a.toggles[name] === b.toggles[name]);
}

/**
 * The Scene Effects to render: the switched-on ones with the Style's settings (an effect's own
 * defaults where the Style does not suggest it), fog distances times `fogScale` (see
 * {@link scaleFog}). Null when everything is off.
 */
export function sceneSettings(style: StyleName, choice: SceneChoice, fogScale: number): SceneEffectsSettings | null {
  const suggested = SUGGESTED_SCENE_EFFECTS[style];
  const settings: SceneEffectsSettings = {};
  for (const name of SCENE_EFFECT_NAMES) {
    if (!choice.toggles[name]) continue;
    const options = suggested[name] ?? {};
    Object.assign(settings, { [name]: name === 'fog' ? scaleFog(options as SceneFogOptions, fogScale) : options });
  }
  if (choice.antialias) settings.antialias = choice.antialias;
  return Object.keys(settings).length > 0 ? settings : null;
}

/**
 * Fog with every distance (fog, mist and far layer near/far) times `scale`; heights, strengths and
 * the colour stay. Distances left out get the fog's own defaults (`sceneFog`), scaled.
 */
export function scaleFog(fog: SceneFogOptions, scale: number): SceneFogOptions {
  if (scale === 1) return fog;
  const scaled: SceneFogOptions = { ...fog, near: (fog.near ?? 10) * scale, far: (fog.far ?? 80) * scale };
  const mist = fog.mist;
  if (mist) {
    scaled.mist = { ...mist, near: (mist.near ?? 8) * scale, far: (mist.far ?? 40) * scale };
    const layer = mist.farLayer;
    if (layer) scaled.mist.farLayer = { ...layer, near: (layer.near ?? 30) * scale, far: (layer.far ?? 120) * scale };
  }
  return scaled;
}
