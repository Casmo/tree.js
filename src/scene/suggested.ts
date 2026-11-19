import type { StyleName } from '../styles/registry';
import type { SceneEffectsSettings } from './settings';

/**
 * The suggested Scene Effects for each built-in Style (plain data: read, copy or change it).
 * TRAA and motion blur are never suggested.
 */
export const SUGGESTED_SCENE_EFFECTS: Record<StyleName, SceneEffectsSettings> = {
  // Crisp and flat: Neutral keeps the flat colours close to their base colour.
  'low-poly': {
    toneMapping: { mapping: 'neutral' },
  },
  // AgX keeps greens green (ACES shifts them towards yellow) and rolls off bright highlights softly.
  stylized: {
    toneMapping: { mapping: 'agx' },
  },
  realistic: {
    toneMapping: { mapping: 'agx' },
  },
};
