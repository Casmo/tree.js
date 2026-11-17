import { describe, expect, it } from 'vitest';
import { TREE_EFFECT_PRESETS } from '@casmo/tree.js/effects';
import { effectsPreset, styleOfSource, suggestedEffects } from './effects-choice';

describe('styleOfSource', () => {
  it('takes the Style of a built-in starting point', () => {
    expect(styleOfSource('stylized/conifer')).toBe('stylized');
    expect(styleOfSource('low-poly/broadleaf')).toBe('low-poly');
  });
  it('is null for an imported file or an unknown Style', () => {
    expect(styleOfSource('my-oak.tree.json')).toBeNull();
    expect(styleOfSource('')).toBeNull();
    expect(styleOfSource('voxel/conifer')).toBeNull();
  });
});

describe('suggestedEffects', () => {
  it("switches on exactly the effects in the Style's suggested combination", () => {
    expect(suggestedEffects('low-poly')).toEqual({ grade: true, glow: false, outline: true });
    expect(suggestedEffects('stylized')).toEqual({ grade: true, glow: true, outline: true });
    expect(suggestedEffects('realistic')).toEqual({ grade: true, glow: true, outline: false });
  });
});

describe('effectsPreset', () => {
  it('is null when every effect is off (the preview renders without post-processing)', () => {
    expect(effectsPreset('stylized', { grade: false, glow: false, outline: false })).toBeNull();
  });
  it("uses the Style's settings for the effects that are on", () => {
    expect(effectsPreset('stylized', { grade: false, glow: true, outline: false })).toEqual({
      glow: { color: '#fff6c8', intensity: 0.45, threshold: 0.3, radius: 8 },
    });
  });
  it("is the Style's suggested combination when its suggestion is applied", () => {
    expect(effectsPreset('low-poly', suggestedEffects('low-poly'))).toEqual(TREE_EFFECT_PRESETS['low-poly']);
  });
  it("uses the effect's defaults when the Style does not suggest it", () => {
    expect(effectsPreset('low-poly', { grade: false, glow: true, outline: false })).toEqual({ glow: {} });
  });
});
