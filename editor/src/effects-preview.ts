// Effects in the editor preview: which Tree Effects and Scene Effects are on, with which Style's
// settings, and the Scene Pipeline that draws them. With everything off the preview renders as before
// (no pipeline); the first effect switched on creates the pipeline, later changes reuse it.
// The choice is preview-only: it is not part of the Definition (nor of undo, autosave or exports).
import { STYLE_NAMES, type StyleName } from '@casmo/tree.js';
import type { TreeEffectsSettings } from '@casmo/tree.js/effects';
import { createScenePipeline, type SceneEffectsSettings } from '@casmo/tree.js/scene';
import { EFFECT_NAMES, effectsSettings, NO_EFFECTS, styleOfSource, suggestedEffects, type EffectName, type EffectToggles } from './effects-choice';
import type { Preview } from './preview';
import {
  NO_SCENE_EFFECTS,
  sameSceneChoice,
  sceneSettings,
  suggestedScene,
  type AntialiasChoice,
  type SceneChoice,
  type SceneEffectName,
} from './scene-choice';
import type { EditorStore } from './store';

/**
 * The camera distance (metres) at which the preview shows the suggested fog as it is: the framed tree
 * gets the fog a tree this far away gets in the suggestion's scene (SUGGESTED_SCENE_EFFECTS is tuned
 * for trees 10-140 m away). Other framings scale every fog distance by framingDistance / this.
 */
export const FOG_REFERENCE_DISTANCE = 20;

/**
 * Frames the preview draws after each change while the pipeline is on: some effects need more than
 * one (SMAA's lookup textures load a moment after it is built). A TRAA convergence count goes here.
 */
export const SETTLE_FRAMES = 4;

/** The parts of the Preview the effects need. */
export type EffectsPreviewTarget = Pick<
  Preview,
  'renderer' | 'scene' | 'camera' | 'sun' | 'framingDistance' | 'onFramed' | 'setSunShadows' | 'renderFrame' | 'requestRender'
>;

/** A post-processing pipeline drawing Tree Effects and Scene Effects (a ScenePipeline from the library). */
export interface EffectsPipeline {
  set(choice: { treeEffects: TreeEffectsSettings | null; sceneEffects: SceneEffectsSettings | null }): void;
  render(): void;
  dispose(): void;
}

export interface EffectsPreviewOptions {
  /** Makes the pipeline (default: the library's `createScenePipeline` on the preview's scene and sun). */
  create?: (preview: EffectsPreviewTarget) => EffectsPipeline;
}

export interface EffectsPreview {
  /** Whose settings (and suggestions) are used. Follows the Style of the starting point. */
  readonly style: StyleName;
  /** Which Tree Effects are on. */
  readonly toggles: EffectToggles;
  /** The Tree Effects drawn now (null: none). */
  readonly settings: TreeEffectsSettings | null;
  /** Which Scene Effects are on, and the anti-aliasing. */
  readonly scene: SceneChoice;
  /** The Scene Effects drawn now, fog scaled to the framing (null: none). */
  readonly sceneSettings: SceneEffectsSettings | null;
  toggle(name: EffectName, on: boolean): void;
  toggleScene(name: SceneEffectName, on: boolean): void;
  setAntialias(mode: AntialiasChoice): void;
  setStyle(style: StyleName): void;
  /** Switches on exactly the Style's suggested Tree Effects and Scene Effects (never TRAA or motion blur). */
  applySuggested(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createEffectsPreview(preview: EffectsPreviewTarget, store: EditorStore, options: EffectsPreviewOptions = {}): EffectsPreview {
  const create =
    options.create ??
    ((target) => createScenePipeline(target.renderer, target.scene, target.camera, { sun: target.sun, treeEffects: null, sceneEffects: null }));
  const plainFrame = preview.renderFrame;
  const listeners = new Set<() => void>();
  let style: StyleName = styleOfSource(store.state.source) ?? STYLE_NAMES[0]!;
  let toggles: EffectToggles = NO_EFFECTS;
  let scene: SceneChoice = NO_SCENE_EFFECTS;
  let settings: TreeEffectsSettings | null = null;
  let scened: SceneEffectsSettings | null = null;
  let pipeline: EffectsPipeline | null = null;

  /** Draws the current choice (one place for every change: pipeline, sun shadows, frame request). */
  const apply = (): void => {
    settings = effectsSettings(style, toggles);
    scened = sceneSettings(style, scene, preview.framingDistance / FOG_REFERENCE_DISTANCE);
    // God rays read the sun's shadows when the pipeline is set: switch them first.
    preview.setSunShadows(!!scened?.godrays);
    if (settings || scened) pipeline ??= create(preview);
    // Also when everything is off: the pipeline gives the scene back (fog).
    pipeline?.set({ treeEffects: settings, sceneEffects: scened });
    const active = settings || scened ? pipeline : null;
    preview.renderFrame = active ? () => active.render() : plainFrame;
    preview.requestRender(active ? SETTLE_FRAMES : 1);
  };

  const update = (nextStyle: StyleName, nextToggles: EffectToggles, nextScene: SceneChoice): void => {
    if (nextStyle === style && EFFECT_NAMES.every((name) => nextToggles[name] === toggles[name]) && sameSceneChoice(nextScene, scene)) return;
    style = nextStyle;
    toggles = Object.freeze({ ...nextToggles });
    scene = Object.freeze({ toggles: Object.freeze({ ...nextScene.toggles }), antialias: nextScene.antialias });
    apply();
    for (const listener of listeners) listener();
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.source === previous.source) return;
    const next = styleOfSource(state.source);
    if (next) update(next, toggles, scene);
  });
  // A new framing (another starting point) rescales the fog.
  const unframed = preview.onFramed(() => {
    if (scene.toggles.fog) apply();
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
    get scene() {
      return scene;
    },
    get sceneSettings() {
      return scened;
    },
    toggle: (name, on) => update(style, { ...toggles, [name]: on }, scene),
    toggleScene: (name, on) => update(style, toggles, { ...scene, toggles: { ...scene.toggles, [name]: on } }),
    setAntialias: (mode) => update(style, toggles, { ...scene, antialias: mode }),
    setStyle: (next) => update(next, toggles, scene),
    applySuggested: () => update(style, suggestedEffects(style), suggestedScene(style)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribe();
      unframed();
      listeners.clear();
      preview.renderFrame = plainFrame;
      preview.setSunShadows(false);
      pipeline?.dispose();
      pipeline = null;
    },
  };
}
