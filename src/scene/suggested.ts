import type { StyleName } from '../styles/registry';
import type { SceneEffectsSettings } from './settings';

/**
 * The suggested Scene Effects for each built-in Style (plain data: read, copy or change it), tuned
 * against the PR #51 concept images on the `examples/scene-pipeline` scene (a tree 10-15 m away in
 * front of a small Forest, a plain sky, a side sun). TRAA and motion blur are never suggested.
 * SMAA for every Style: the Tree ID channel turns MSAA off (ADR 0009), and SMAA keeps low-poly
 * facets and leaf cards sharper than FXAA. Fog in metres: the front trees stay clear and the trees
 * behind them fade a little; scale the distances up for large worlds.
 */
export const SUGGESTED_SCENE_EFFECTS: Record<StyleName, SceneEffectsSettings> = {
  // Crisp and flat: Neutral keeps the flat colours close to their base colour; no bloom, no god rays.
  'low-poly': {
    toneMapping: { mapping: 'neutral' },
    // Light GTAO: a hint of ground contact that keeps the flat shading flat.
    ao: { radius: 1, scale: 0.7, thickness: 1 },
    antialias: 'smaa',
    fog: { near: 15, far: 120 },
  },
  // AgX keeps greens green (ACES shifts them towards yellow) and rolls off bright highlights softly;
  // a little more exposure makes up for AgX's darker mid-tones.
  stylized: {
    toneMapping: { mapping: 'agx', exposure: 1.2 },
    ao: { radius: 1.2, scale: 1.3, thickness: 2 },
    // Soft bloom: a plain light sky (linear luminance about 0.6) glows widely and faintly over the
    // crown edges. Bloom is all-or-nothing per pixel above the threshold, so the strength stays low.
    bloom: { strength: 0.1, radius: 0.6, threshold: 0.55 },
    antialias: 'smaa',
    // Distance fog plus a low mist around the trunks.
    fog: { near: 15, far: 130, mist: { height: 1.5, strength: 0.5, near: 10, far: 50 } },
  },
  realistic: {
    toneMapping: { mapping: 'agx', exposure: 1.2 },
    ao: { radius: 1.2, scale: 1.6, thickness: 2 },
    // Subtle bloom: a narrow glare of the bright sky through the leaves.
    bloom: { strength: 0.06, radius: 0.3, threshold: 0.55 },
    // Warm light shafts (needs the app's shadow-casting `sun`). God rays also light the air between
    // the camera and everything behind it, so low numbers: in the open the shafts stay a faint
    // warm haze, under a dense canopy they read as rays.
    godrays: { density: 0.2, maxDensity: 0.05, distanceAttenuation: 2, color: '#fff0c8' },
    antialias: 'smaa',
    // Distance fog, a height mist and a thin far layer over the whole height.
    fog: { near: 15, far: 140, mist: { height: 2, strength: 0.4, near: 10, far: 60, farLayer: { near: 40, far: 200, strength: 0.2 } } },
  },
  // Complete in its own materials (ADR 0014): no tone mapping curve (the renderer's own output, which
  // the painted colours are tuned for: AgX and Neutral wash out or darken them), no bloom. Only soft AO
  // for ground contact, SMAA for the alpha-cut cards and distance fog.
  painterly: {
    ao: { radius: 1, scale: 0.7, thickness: 1.5 },
    antialias: 'smaa',
    fog: { near: 15, far: 130 },
  },
  // Bright and saturated: Neutral, not AgX (AgX greys the candy colours and the sky at any exposure), light
  // AO (the shade is meant to stay bright), a light pastel pink fog that only touches the far trees and
  // almost no bloom (the colours glow on their own).
  whimsical: {
    toneMapping: { mapping: 'neutral' },
    ao: { radius: 1, scale: 0.5, thickness: 1.5 },
    bloom: { strength: 0.02, radius: 0.4, threshold: 0.9 },
    antialias: 'smaa',
    fog: { color: '#fdf0f8', near: 30, far: 220 },
  },
  // Made for the dark: AgX, a strong bloom with a low threshold so the Inner Glow blooms, AO for ground
  // contact and a violet mist lying low on the ground.
  enchanted: {
    toneMapping: { mapping: 'agx', exposure: 1.1 },
    ao: { radius: 1.2, scale: 1.2, thickness: 2 },
    bloom: { strength: 0.6, radius: 0.6, threshold: 0.15 },
    antialias: 'smaa',
    fog: { color: '#5e3888', near: 20, far: 140, mist: { height: 1.8, strength: 0.6, near: 8, far: 45 } },
  },
};
