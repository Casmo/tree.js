import type { StyleName } from '../styles/registry';
import type { SceneEffectsSettings } from './settings';

/**
 * The suggested Scene Effects for each built-in Style (plain data: read, copy or change it).
 * TRAA and motion blur are never suggested. SMAA for every Style: the Tree ID channel turns MSAA off
 * (ADR 0009), and SMAA keeps low-poly facets and leaf cards sharper than FXAA.
 */
export const SUGGESTED_SCENE_EFFECTS: Record<StyleName, SceneEffectsSettings> = {
  // Crisp and flat: Neutral keeps the flat colours close to their base colour; no bloom.
  'low-poly': {
    toneMapping: { mapping: 'neutral' },
    // Light GTAO: a hint of ground contact that keeps the flat shading flat.
    ao: { radius: 1, scale: 0.7, thickness: 1 },
    antialias: 'smaa',
  },
  // AgX keeps greens green (ACES shifts them towards yellow) and rolls off bright highlights softly.
  // Soft bloom: the bright sky glows widely over the crown edges.
  stylized: {
    toneMapping: { mapping: 'agx' },
    ao: { radius: 1.2, scale: 1.3, thickness: 2 },
    bloom: { strength: 0.3, radius: 0.7, threshold: 0.5 },
    antialias: 'smaa',
  },
  // Subtle bloom: a little glare from the bright sky through the leaves.
  realistic: {
    toneMapping: { mapping: 'agx' },
    ao: { radius: 1.2, scale: 1.6, thickness: 2 },
    bloom: { strength: 0.2, radius: 0.4, threshold: 0.6 },
    antialias: 'smaa',
  },
};
