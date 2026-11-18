import { describe, expect, it } from 'vitest';
import { SUGGESTED_TREE_EFFECTS } from '@casmo/tree.js/effects';
import { effectsSettings, styleOfSource, suggestedEffects } from './effects-choice';

describe('styleOfSource', () => {
  it('takes the Style of a built-in starting point', () => {
    expect(styleOfSource('stylized/conifer')).toBe('stylized');
    expect(styleOfSource('low-poly/broadleaf')).toBe('low-poly');
    expect(styleOfSource('oak/realistic')).toBe('realistic');
    expect(styleOfSource('conifer/stylized')).toBe('stylized');
  });
  it('is null for an imported file or an unknown Style', () => {
    expect(styleOfSource('my-oak.tree.json')).toBeNull();
    expect(styleOfSource('')).toBeNull();
    expect(styleOfSource('voxel/conifer')).toBeNull();
  });
});

describe('suggestedEffects', () => {
  it("switches on exactly the effects in the Style's suggested combination", () => {
    expect(suggestedEffects('low-poly')).toEqual({ grade: true, glow: false, innerLines: true, outline: true });
    expect(suggestedEffects('stylized')).toEqual({ grade: true, glow: true, innerLines: true, outline: true });
    expect(suggestedEffects('realistic')).toEqual({ grade: true, glow: true, innerLines: false, outline: false });
  });
});

describe('effectsSettings', () => {
  it("switches Inner Lines on with the Style's ink settings", () => {
    expect(effectsSettings('stylized', { grade: false, glow: false, innerLines: true, outline: false })).toEqual({
      innerLines: { color: '#2b3a1c', thickness: 1, strength: 0.45, normalThreshold: 0.5 },
    });
    expect(effectsSettings('realistic', { grade: false, glow: false, innerLines: true, outline: false })).toEqual({ innerLines: {} });
  });
  it('is null when every effect is off (the preview renders without post-processing)', () => {
    expect(effectsSettings('stylized', { grade: false, glow: false, innerLines: false, outline: false })).toBeNull();
  });
  it("uses the Style's settings for the effects that are on", () => {
    expect(effectsSettings('stylized', { grade: false, glow: true, innerLines: false, outline: false })).toEqual({
      glow: { color: '#fff6c8', intensity: 0.45, threshold: 0.3, radius: 8 },
    });
  });
  it("is the Style's suggested combination when its suggestion is applied", () => {
    expect(effectsSettings('low-poly', suggestedEffects('low-poly'))).toEqual(SUGGESTED_TREE_EFFECTS['low-poly']);
    expect(effectsSettings('stylized', suggestedEffects('stylized'))).toEqual(SUGGESTED_TREE_EFFECTS.stylized);
  });
  it("uses the effect's defaults when the Style does not suggest it", () => {
    expect(effectsSettings('low-poly', { grade: false, glow: true, innerLines: false, outline: false })).toEqual({ glow: {} });
  });
});
