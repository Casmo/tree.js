import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION } from '@casmo/tree.js';
import { SUGGESTED_TREE_EFFECTS, type TreeEffectsSettings } from '@casmo/tree.js/effects';
import { SUGGESTED_SCENE_EFFECTS, type SceneEffectsSettings } from '@casmo/tree.js/scene';
import { createEditorStore } from './store';
import { createEffectsPreview, FOG_REFERENCE_DISTANCE, SETTLE_FRAMES, type EffectsPreviewTarget } from './effects-preview';

/** A stand-in for the Preview and the Tree Effects pipeline: records what gets drawn how. */
function setup(source = 'stylized/broadleaf') {
  const drawn: string[] = [];
  const renders = { count: 0, frames: [] as number[] };
  /** The preview sun's shadows, as the pipeline saw them when it was last set. */
  const sun = { shadows: false, shadowsWhenSet: false };
  const framed = new Set<() => void>();
  const preview: EffectsPreviewTarget & { frameAt(distance: number): void } = {
    renderer: {} as never,
    scene: {} as never,
    camera: {} as never,
    sun: {} as never,
    framingDistance: FOG_REFERENCE_DISTANCE,
    onFramed: (listener) => (framed.add(listener), () => void framed.delete(listener)),
    setSunShadows: (on) => void (sun.shadows = on),
    renderFrame: () => void drawn.push('plain'),
    requestRender: (frames = 1) => {
      renders.count++;
      renders.frames.push(frames);
    },
    frameAt(distance) {
      this.framingDistance = distance;
      for (const listener of framed) listener();
    },
  };
  const pipelines: { settings: TreeEffectsSettings | null; scene: SceneEffectsSettings | null; disposed: boolean }[] = [];
  const store = createEditorStore({ definition: DEFAULT_DEFINITION, source });
  const effects = createEffectsPreview(preview, store, {
    create: () => {
      const pipeline = { settings: null as TreeEffectsSettings | null, scene: null as SceneEffectsSettings | null, disposed: false };
      pipelines.push(pipeline);
      return {
        set: (choice) => {
          pipeline.settings = choice.treeEffects;
          pipeline.scene = choice.sceneEffects;
          sun.shadowsWhenSet = sun.shadows;
        },
        render: () => {
          const scene = pipeline.scene ? `|scene:${Object.keys(pipeline.scene).join('+')}` : '';
          drawn.push(`effects:${Object.keys(pipeline.settings ?? {}).join('+')}${scene}`);
        },
        dispose: () => void (pipeline.disposed = true),
      };
    },
  });
  const draw = () => {
    drawn.length = 0;
    void preview.renderFrame();
    return drawn[0];
  };
  return { preview, store, effects, pipelines, draw, renders, sun };
}

describe('Tree Effects preview', () => {
  it('starts with every effect off and draws without post-processing', () => {
    const { effects, draw, pipelines } = setup();
    expect(effects.toggles).toEqual({ grade: false, glow: false, innerLines: false, outline: false });
    expect(draw()).toBe('plain');
    expect(pipelines).toHaveLength(0);
  });

  it('toggles each effect on and off in the preview', () => {
    const { effects, draw, renders } = setup();
    effects.toggle('outline', true);
    expect(draw()).toBe('effects:outline');
    effects.toggle('glow', true);
    expect(draw()).toBe('effects:glow+outline');
    effects.toggle('outline', false);
    expect(draw()).toBe('effects:glow');
    effects.toggle('glow', false);
    expect(draw()).toBe('plain');
    expect(renders.count).toBe(4);
  });

  it("applies the current Style's suggested Tree Effects and Scene Effects in one action", () => {
    const { effects, draw, pipelines } = setup('low-poly/conifer');
    expect(effects.style).toBe('low-poly');
    effects.applySuggested();
    expect(effects.toggles).toEqual({ grade: true, glow: false, innerLines: true, outline: true });
    expect(effects.scene).toEqual({ toggles: { toneMapping: true, ao: true, bloom: false, fog: true, godrays: false }, antialias: 'smaa' });
    expect(draw()).toBe('effects:grade+innerLines+outline|scene:toneMapping+ao+fog+antialias');
    expect(pipelines.at(-1)!.settings).toEqual(SUGGESTED_TREE_EFFECTS['low-poly']);
    // At the reference framing the fog is the suggestion's own.
    expect(pipelines.at(-1)!.scene).toEqual(SUGGESTED_SCENE_EFFECTS['low-poly']);
  });

  it('follows the Style of a newly chosen starting point, keeping the toggles', () => {
    const { store, effects, pipelines } = setup('low-poly/conifer');
    effects.toggle('outline', true);
    store.loadDefinition(DEFAULT_DEFINITION, 'stylized/conifer');
    expect(effects.style).toBe('stylized');
    expect(pipelines.at(-1)!.settings).toEqual({ outline: SUGGESTED_TREE_EFFECTS.stylized.outline });
    // An imported file has no Style: keep the last one.
    store.loadDefinition(DEFAULT_DEFINITION, 'oak.tree.json');
    expect(effects.style).toBe('stylized');
  });

  it("can pick another Style's settings (e.g. for an imported tree)", () => {
    const { effects, pipelines } = setup('oak.tree.json');
    expect(effects.style).toBe('low-poly'); // no Style known: the first built-in one
    effects.setStyle('realistic');
    effects.applySuggested();
    expect(pipelines.at(-1)!.settings).toEqual(SUGGESTED_TREE_EFFECTS.realistic);
  });

  it('reuses one pipeline and disposes it with the preview effects', () => {
    const { effects, pipelines, draw } = setup();
    effects.toggle('grade', true);
    effects.toggle('grade', false);
    effects.toggle('glow', true);
    expect(pipelines).toHaveLength(1);
    effects.dispose();
    expect(pipelines[0]!.disposed).toBe(true);
    expect(draw()).toBe('plain');
  });

  it('notifies listeners of every change', () => {
    const { effects } = setup();
    const seen: string[] = [];
    effects.subscribe(() => seen.push(`${effects.style}:${effects.toggles.outline}`));
    effects.toggle('outline', true);
    effects.setStyle('realistic');
    expect(seen).toEqual(['stylized:true', 'realistic:true']);
  });
});

describe('Scene Effects preview', () => {
  it('starts with every Scene Effect and AA off', () => {
    const { effects, draw } = setup();
    expect(effects.scene).toEqual({ toggles: { toneMapping: false, ao: false, bloom: false, fog: false, godrays: false }, antialias: null });
    expect(effects.sceneSettings).toBeNull();
    expect(draw()).toBe('plain');
  });

  it('toggles each Scene Effect and the AA choice, with or without Tree Effects', () => {
    const { effects, draw, pipelines } = setup('stylized/broadleaf');
    effects.toggleScene('toneMapping', true);
    expect(draw()).toBe('effects:|scene:toneMapping');
    expect(pipelines.at(-1)!.scene).toEqual({ toneMapping: SUGGESTED_SCENE_EFFECTS.stylized.toneMapping });
    effects.setAntialias('fxaa');
    expect(draw()).toBe('effects:|scene:toneMapping+antialias');
    effects.toggle('outline', true);
    expect(draw()).toBe('effects:outline|scene:toneMapping+antialias');
    effects.toggleScene('toneMapping', false);
    effects.setAntialias(null);
    expect(draw()).toBe('effects:outline');
    effects.toggle('outline', false);
    expect(draw()).toBe('plain');
    expect(pipelines).toHaveLength(1);
  });

  it('switches the pipeline off too when everything is off (it gives the fog back to the scene)', () => {
    const { effects, pipelines } = setup('stylized/broadleaf');
    effects.toggleScene('fog', true);
    effects.toggleScene('fog', false);
    expect(pipelines[0]!.scene).toBeNull();
    expect(pipelines[0]!.settings).toBeNull();
  });

  it('draws a few frames after each change (effect textures that load late, like SMAA\'s, get in), one when plain', () => {
    const { effects, renders } = setup();
    effects.setAntialias('smaa');
    effects.setAntialias(null);
    expect(SETTLE_FRAMES).toBeGreaterThan(1);
    expect(renders.frames).toEqual([SETTLE_FRAMES, 1]);
  });

  it("uses an effect's defaults where the Style does not suggest it", () => {
    const { effects, pipelines } = setup('low-poly/broadleaf');
    effects.toggleScene('bloom', true);
    expect(pipelines.at(-1)!.scene).toEqual({ bloom: {} });
  });

  it('makes the preview sun cast shadows while god rays are on, before the pipeline sees them', () => {
    const { effects, sun, pipelines } = setup('realistic/broadleaf');
    effects.toggleScene('godrays', true);
    expect(sun.shadows).toBe(true);
    expect(sun.shadowsWhenSet).toBe(true);
    expect(pipelines.at(-1)!.scene).toEqual({ godrays: SUGGESTED_SCENE_EFFECTS.realistic.godrays });
    effects.toggleScene('fog', true);
    expect(sun.shadows).toBe(true);
    effects.toggleScene('godrays', false);
    expect(sun.shadows).toBe(false);
    effects.applySuggested();
    expect(sun.shadows).toBe(true);
    effects.dispose();
    expect(sun.shadows).toBe(false);
  });

  it("scales the fog distances to the preview's framing, and follows a new framing", () => {
    const { effects, preview, pipelines, renders } = setup('low-poly/broadleaf');
    preview.frameAt(FOG_REFERENCE_DISTANCE / 4);
    effects.toggleScene('fog', true);
    expect(pipelines.at(-1)!.scene).toEqual({ fog: { near: 15 / 4, far: 120 / 4 } });
    const before = renders.count;
    preview.frameAt(FOG_REFERENCE_DISTANCE / 2);
    expect(pipelines.at(-1)!.scene).toEqual({ fog: { near: 15 / 2, far: 120 / 2 } });
    expect(renders.count).toBe(before + 1);
  });

  it('follows the Style of a newly chosen starting point, keeping the Scene choice', () => {
    const { store, effects, pipelines } = setup('low-poly/conifer');
    effects.toggleScene('bloom', true);
    store.loadDefinition(DEFAULT_DEFINITION, 'realistic/conifer');
    expect(pipelines.at(-1)!.scene).toEqual({ bloom: SUGGESTED_SCENE_EFFECTS.realistic.bloom });
  });

  it('is preview-only: the store (Definition, history, autosave and exports read it) never changes', () => {
    const { store, effects } = setup('realistic/broadleaf');
    const state = store.state;
    let changes = 0;
    store.subscribe(() => changes++);
    effects.applySuggested();
    effects.toggleScene('fog', false);
    effects.setAntialias('fxaa');
    expect(store.state).toBe(state);
    expect(changes).toBe(0);
  });
});
