// Material Features (ADR 0008) in the editor: switching one on or off, applying the Style's suggestion
// or turning them all off. Every change is one store change, so it is one undoable history step;
// a change that would leave the Definition as it is is not made (no empty undo step).
import {
  DEFAULT_OCCLUSION,
  DEFAULT_TRANSLUCENCY,
  materialFeaturesOf,
  SUGGESTED_MATERIAL_FEATURES,
  withMaterialFeatures,
  type MaterialFeatures,
  type StyleName,
  type TreeDefinition,
} from '@casmo/tree.js';
import type { EditorState, EditorStore } from './store';
import { currentStyle } from './style-switch';

export function hasMaterialFeatures(definition: TreeDefinition): boolean {
  return Object.keys(materialFeaturesOf(definition)).length > 0;
}

/** The suggested Material Features of the Style the editor is in. */
export function suggestedMaterialFeatures(state: Pick<EditorState, 'definition' | 'source'>): { style: StyleName; features: MaterialFeatures } {
  const style = currentStyle(state);
  return { style, features: SUGGESTED_MATERIAL_FEATURES[style] };
}

/** Sets exactly these Material Features (`{}` = all off), as one history step; nothing when unchanged. */
export function applyMaterialFeatures(store: EditorStore, features: MaterialFeatures): void {
  const next = withMaterialFeatures(store.state.definition, features);
  if (sameJson(next, store.state.definition)) return;
  store.set({ definition: next });
}

/** Value a feature gets when switched on: the current Style's suggestion, else the library default. */
const FALLBACK: Required<MaterialFeatures> = { crownNormals: 1, translucency: DEFAULT_TRANSLUCENCY, occlusion: DEFAULT_OCCLUSION };

/** Switches one Material Feature on (keeping its values if it is already on) or off (removing its field). */
export function setMaterialFeature(store: EditorStore, key: keyof MaterialFeatures, on: boolean): void {
  const current = materialFeaturesOf(store.state.definition);
  if (on === (current[key] !== undefined)) return;
  const features = { ...current };
  if (on) {
    const value = suggestedMaterialFeatures(store.state).features[key] ?? FALLBACK[key];
    Object.assign(features, { [key]: typeof value === 'object' ? { ...value } : value });
  } else {
    delete features[key];
  }
  applyMaterialFeatures(store, features);
}

/**
 * When `next` differs from `previous` only in the values of Material Features that are on in both, the
 * tree on show can take them as uniforms (`tree.crownNormals`, `tree.translucency`,
 * `tree.occlusionStrength`) without being generated again: returns those features with their new
 * values. Null when anything else changed, a feature was switched on or off (Crown Normals at 0 count
 * as off), or nothing changed.
 */
export function liveMaterialFeatureChange(previous: TreeDefinition, next: TreeDefinition): MaterialFeatures | null {
  if (sameJson(previous, next)) return null;
  const before = materialFeaturesOf(previous);
  const after = materialFeaturesOf(next);
  const crownNormals = !!before.crownNormals && !!after.crownNormals;
  const translucency = !!before.translucency && !!after.translucency;
  const occlusion = !!before.occlusion && !!after.occlusion;
  // Both with the live values blanked out (in place, so the key order stays): equal = nothing else changed.
  const blank = (definition: TreeDefinition): TreeDefinition => ({
    ...definition,
    materials: {
      ...definition.materials,
      leaf: {
        ...definition.materials.leaf,
        ...(crownNormals ? { crownNormals: 1 } : {}),
        ...(translucency ? { translucency: { strength: 0, edge: 0, ambient: 0 } } : {}),
      },
      ...(occlusion ? { occlusion: { strength: 0 } } : {}),
    },
  });
  if (!sameJson(blank(previous), blank(next))) return null;
  return {
    ...(crownNormals ? { crownNormals: after.crownNormals } : {}),
    ...(translucency ? { translucency: after.translucency } : {}),
    ...(occlusion ? { occlusion: after.occlusion } : {}),
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
