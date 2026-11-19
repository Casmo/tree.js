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
    fog: { near: 12, far: 90 },
  },
  // AgX keeps greens green (ACES shifts them towards yellow) and rolls off bright highlights softly.
  stylized: {
    toneMapping: { mapping: 'agx' },
    fog: { near: 10, far: 80, mist: { height: 1.2, strength: 0.5 } },
  },
  realistic: {
    toneMapping: { mapping: 'agx' },
    fog: { near: 8, far: 70, mist: { height: 2, strength: 0.7, farLayer: {} } },
  },
};
