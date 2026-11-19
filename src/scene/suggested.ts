import type { StyleName } from '../styles/registry';
import type { SceneEffectsSettings } from './settings';

/**
 * The suggested Scene Effects for each built-in Style (plain data: read, copy or change it).
 * TRAA and motion blur are never suggested. SMAA for every Style: the Tree ID channel turns MSAA off
 * (ADR 0009), and SMAA keeps low-poly facets and leaf cards sharper than FXAA.
 */
export const SUGGESTED_SCENE_EFFECTS: Record<StyleName, SceneEffectsSettings> = {
  // Crisp and flat: Neutral keeps the flat colours close to their base colour.
  'low-poly': {
    toneMapping: { mapping: 'neutral' },
    antialias: 'smaa',
  },
  // AgX keeps greens green (ACES shifts them towards yellow) and rolls off bright highlights softly.
  stylized: {
    toneMapping: { mapping: 'agx' },
    antialias: 'smaa',
  },
  realistic: {
    toneMapping: { mapping: 'agx' },
    antialias: 'smaa',
  },
};
