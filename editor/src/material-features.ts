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
 * True when `next` differs from `previous` only in the Structural Occlusion strength (both with the
 * feature on): the tree on show can take the new strength without being generated again.
 */
export function onlyOcclusionStrengthChanged(previous: TreeDefinition, next: TreeDefinition): boolean {
  const before = previous.materials.occlusion;
  const after = next.materials.occlusion;
  if (!before || !after || before.strength === after.strength) return false;
  const withStrength = (definition: TreeDefinition): TreeDefinition => ({
    ...definition,
    materials: { ...definition.materials, occlusion: { strength: 0 } },
  });
  return sameJson(withStrength(previous), withStrength(next));
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
