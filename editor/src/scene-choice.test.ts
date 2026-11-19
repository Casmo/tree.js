import { describe, expect, it } from 'vitest';
import { SUGGESTED_SCENE_EFFECTS } from '@casmo/tree.js/scene';
import { NO_SCENE_EFFECTS, sceneSettings, scaleFog, suggestedScene } from './scene-choice';

describe('suggestedScene', () => {
  it("switches on exactly the Scene Effects in the Style's suggestion, with its AA choice", () => {
    expect(suggestedScene('low-poly')).toEqual({
      toggles: { toneMapping: true, ao: true, bloom: false, fog: true, godrays: false },
      antialias: 'smaa',
    });
    expect(suggestedScene('stylized').toggles).toEqual({ toneMapping: true, ao: true, bloom: true, fog: true, godrays: false });
    expect(suggestedScene('realistic')).toEqual({
      toggles: { toneMapping: true, ao: true, bloom: true, fog: true, godrays: true },
      antialias: 'smaa',
    });
  });
});

describe('sceneSettings', () => {
  it('is null when every Scene Effect and AA are off (no Scene Effects in the preview)', () => {
    expect(NO_SCENE_EFFECTS.antialias).toBeNull();
    expect(sceneSettings('realistic', NO_SCENE_EFFECTS, 1)).toBeNull();
  });
  it("uses the Style's settings for the effects that are on", () => {
    const choice = { toggles: { ...NO_SCENE_EFFECTS.toggles, bloom: true }, antialias: null };
    expect(sceneSettings('stylized', choice, 1)).toEqual({ bloom: { strength: 0.1, radius: 0.6, threshold: 0.55 } });
  });
  it("uses the effect's defaults when the Style does not suggest it", () => {
    const choice = { toggles: { ...NO_SCENE_EFFECTS.toggles, godrays: true }, antialias: null };
    expect(sceneSettings('low-poly', choice, 1)).toEqual({ godrays: {} });
  });
  it('takes the AA choice on its own', () => {
    expect(sceneSettings('low-poly', { ...NO_SCENE_EFFECTS, antialias: 'fxaa' }, 1)).toEqual({ antialias: 'fxaa' });
  });
  it("is the Style's suggestion when it is applied (fog unscaled at scale 1)", () => {
    for (const style of ['low-poly', 'stylized', 'realistic'] as const) {
      expect(sceneSettings(style, suggestedScene(style), 1)).toEqual(SUGGESTED_SCENE_EFFECTS[style]);
    }
  });
  it('scales the fog distances by the framing scale', () => {
    const choice = { toggles: { ...NO_SCENE_EFFECTS.toggles, fog: true }, antialias: null };
    expect(sceneSettings('low-poly', choice, 0.5)).toEqual({ fog: { near: 7.5, far: 60 } });
  });
});

describe('scaleFog', () => {
  it('scales every distance, mist and far layer included, and keeps heights, strengths and colour', () => {
    expect(
      scaleFog({ color: '#fff', near: 10, far: 100, mist: { height: 2, strength: 0.4, near: 10, far: 60, farLayer: { near: 40, far: 200, strength: 0.2 } } }, 0.1),
    ).toEqual({ color: '#fff', near: 1, far: 10, mist: { height: 2, strength: 0.4, near: 1, far: 6, farLayer: { near: 4, far: 20, strength: 0.2 } } });
  });
  it("scales the fog's own default distances when none are given", () => {
    expect(scaleFog({}, 0.5)).toEqual({ near: 5, far: 40 });
    expect(scaleFog({ mist: {} }, 0.5)).toEqual({ near: 5, far: 40, mist: { near: 4, far: 20 } });
    expect(scaleFog({ mist: { farLayer: {} } }, 0.5)).toEqual({ near: 5, far: 40, mist: { near: 4, far: 20, farLayer: { near: 15, far: 60 } } });
  });
});
