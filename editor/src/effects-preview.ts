// Tree Effects in the editor preview: which effects are on, with which Style's settings, and the
// post-processing pipeline that draws them. With every effect off the preview renders as before
// (no pipeline); the first effect switched on creates the pipeline, later changes reuse it.
// The choice is preview-only: it is not part of the Definition (nor of undo or autosave).
import { STYLE_NAMES, type StyleName } from '@casmo/tree.js';
import { createTreeEffects, type TreeEffectsSettings } from '@casmo/tree.js/effects';
import { EFFECT_NAMES, effectsSettings, NO_EFFECTS, styleOfSource, suggestedEffects, type EffectName, type EffectToggles } from './effects-choice';
import type { Preview } from './preview';
import type { EditorStore } from './store';

/** The parts of the Preview the effects need. */
export type EffectsPreviewTarget = Pick<Preview, 'renderer' | 'scene' | 'camera' | 'renderFrame' | 'requestRender'>;

/** A post-processing pipeline drawing a combination of Tree Effects (TreeEffects from the library). */
export interface EffectsPipeline {
  set(settings: TreeEffectsSettings | null): void;
  render(): void;
  dispose(): void;
}

export interface EffectsPreviewOptions {
  /** Makes the pipeline (default: the library's `createTreeEffects` on the preview's scene). */
  create?: (preview: EffectsPreviewTarget) => EffectsPipeline;
}

export interface EffectsPreview {
  /** Whose settings (and suggested combination) are used. Follows the Style of the starting point. */
  readonly style: StyleName;
  readonly toggles: EffectToggles;
  /** What is drawn now (null: no effects). */
  readonly settings: TreeEffectsSettings | null;
  toggle(name: EffectName, on: boolean): void;
  setStyle(style: StyleName): void;
  /** Switches on exactly the effects of the Style's suggested combination. */
  applySuggested(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createEffectsPreview(preview: EffectsPreviewTarget, store: EditorStore, options: EffectsPreviewOptions = {}): EffectsPreview {
  const create = options.create ?? ((target) => createTreeEffects(target.renderer, target.scene, target.camera));
  const plainFrame = preview.renderFrame;
  const listeners = new Set<() => void>();
  let style: StyleName = styleOfSource(store.state.source) ?? STYLE_NAMES[0]!;
  let toggles: EffectToggles = NO_EFFECTS;
  let settings: TreeEffectsSettings | null = null;
  let pipeline: EffectsPipeline | null = null;

  const update = (nextStyle: StyleName, nextToggles: EffectToggles): void => {
    if (nextStyle === style && EFFECT_NAMES.every((name) => nextToggles[name] === toggles[name])) return;
    style = nextStyle;
    toggles = Object.freeze({ ...nextToggles });
    settings = effectsSettings(style, toggles);
    if (settings) {
      pipeline ??= create(preview);
      pipeline.set(settings);
      const active = pipeline;
      preview.renderFrame = () => active.render();
    } else {
      preview.renderFrame = plainFrame;
    }
    preview.requestRender();
    for (const listener of listeners) listener();
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.source === previous.source) return;
    const next = styleOfSource(state.source);
    if (next) update(next, toggles);
  });

  return {
    get style() {
      return style;
    },
    get toggles() {
      return toggles;
    },
    get settings() {
      return settings;
    },
    toggle: (name, on) => update(style, { ...toggles, [name]: on }),
    setStyle: (next) => update(next, toggles),
    applySuggested: () => update(style, suggestedEffects(style)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribe();
      listeners.clear();
      preview.renderFrame = plainFrame;
      pipeline?.dispose();
      pipeline = null;
    },
  };
}
