import type { StyleName } from '../styles/registry';
import type { SceneEffectsSettings } from './settings';

/**
 * The suggested Scene Effects for each built-in Style (plain data: read, copy or change it).
 * TRAA and motion blur are never suggested.
 */
export const SUGGESTED_SCENE_EFFECTS: Record<StyleName, SceneEffectsSettings> = {
  // Crisp and flat: Neutral keeps the flat colours close to their base colour; no bloom.
  'low-poly': {
    toneMapping: { mapping: 'neutral' },
  },
  // AgX keeps greens green (ACES shifts them towards yellow) and rolls off bright highlights softly.
  // Soft bloom: the bright sky glows widely over the crown edges.
  stylized: {
    toneMapping: { mapping: 'agx' },
    bloom: { strength: 0.3, radius: 0.7, threshold: 0.5 },
  },
  // Subtle bloom: a little glare from the bright sky through the leaves.
  realistic: {
    toneMapping: { mapping: 'agx' },
    bloom: { strength: 0.2, radius: 0.4, threshold: 0.6 },
  },
};
