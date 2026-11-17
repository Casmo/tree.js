import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION } from '@casmo/tree.js';
import { TREE_EFFECT_PRESETS, type TreeEffectsPreset } from '@casmo/tree.js/effects';
import { createEditorStore } from './store';
import { createEffectsPreview, type EffectsPreviewTarget } from './effects-preview';

/** A stand-in for the Preview and the Tree Effects pipeline: records what gets drawn how. */
function setup(source = 'stylized/broadleaf') {
  const drawn: string[] = [];
  const renders = { count: 0 };
  const preview: EffectsPreviewTarget = {
    renderer: {} as never,
    scene: {} as never,
    camera: {} as never,
    renderFrame: () => void drawn.push('plain'),
    requestRender: () => void renders.count++,
  };
  const pipelines: { preset: TreeEffectsPreset | null; disposed: boolean }[] = [];
  const store = createEditorStore({ definition: DEFAULT_DEFINITION, source });
  const effects = createEffectsPreview(preview, store, {
    create: () => {
      const pipeline = { preset: null as TreeEffectsPreset | null, disposed: false };
      pipelines.push(pipeline);
      return {
        set: (preset) => void (pipeline.preset = preset),
        render: () => void drawn.push(`effects:${Object.keys(pipeline.preset ?? {}).join('+')}`),
        dispose: () => void (pipeline.disposed = true),
      };
    },
  });
  const draw = () => {
    drawn.length = 0;
    void preview.renderFrame();
    return drawn[0];
  };
  return { preview, store, effects, pipelines, draw, renders };
}

describe('Tree Effects preview', () => {
  it('starts with every effect off and draws without post-processing', () => {
    const { effects, draw, pipelines } = setup();
    expect(effects.toggles).toEqual({ grade: false, glow: false, outline: false });
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

  it("applies the current Style's suggested combination in one action", () => {
    const { effects, draw, pipelines } = setup('low-poly/conifer');
    expect(effects.style).toBe('low-poly');
    effects.applySuggested();
    expect(effects.toggles).toEqual({ grade: true, glow: false, outline: true });
    expect(draw()).toBe('effects:grade+outline');
    expect(pipelines.at(-1)!.preset).toEqual(TREE_EFFECT_PRESETS['low-poly']);
  });

  it('follows the Style of a newly chosen starting point, keeping the toggles', () => {
    const { store, effects, pipelines } = setup('low-poly/conifer');
    effects.toggle('outline', true);
    store.loadDefinition(DEFAULT_DEFINITION, 'stylized/conifer');
    expect(effects.style).toBe('stylized');
    expect(pipelines.at(-1)!.preset).toEqual({ outline: TREE_EFFECT_PRESETS.stylized.outline });
    // An imported file has no Style: keep the last one.
    store.loadDefinition(DEFAULT_DEFINITION, 'oak.tree.json');
    expect(effects.style).toBe('stylized');
  });

  it("can pick another Style's settings (e.g. for an imported tree)", () => {
    const { effects, pipelines } = setup('oak.tree.json');
    expect(effects.style).toBe('low-poly'); // no Style known: the first built-in one
    effects.setStyle('realistic');
    effects.applySuggested();
    expect(pipelines.at(-1)!.preset).toEqual(TREE_EFFECT_PRESETS.realistic);
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
