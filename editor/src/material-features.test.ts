import { describe, expect, it } from 'vitest';
import { createHistory } from './history';
import {
  applyMaterialFeatures,
  hasMaterialFeatures,
  liveMaterialFeatureChange,
  setMaterialFeature,
  suggestedMaterialFeatures,
} from './material-features';
import { loadStart } from './starts';
import { createEditorStore } from './store';

/** An editor started from `id`, with undo history on a clock that moves 10 s per edit (no merging). */
async function editor(id: string) {
  const store = createEditorStore({ definition: await loadStart(id), source: id, seed: 1 });
  let time = 0;
  const history = createHistory(store, { now: () => (time += 10_000) });
  return { store, history };
}

const featuresOf = (definition: { materials: { occlusion?: unknown; leaf: { crownNormals?: unknown; translucency?: unknown } } }) => ({
  crownNormals: definition.materials.leaf.crownNormals,
  translucency: definition.materials.leaf.translucency,
  occlusion: definition.materials.occlusion,
});

describe('Material features in the editor', () => {
  it('start off for every built-in start', async () => {
    const { store } = await editor('oak/stylized');
    expect(hasMaterialFeatures(store.state.definition)).toBe(false);
    expect(featuresOf(store.state.definition)).toEqual({ crownNormals: undefined, translucency: undefined, occlusion: undefined });
  });

  it("toggle a feature on with the Style's suggested value (else the library default) and off by removing it", async () => {
    const { store } = await editor('oak/low-poly');
    setMaterialFeature(store, 'crownNormals', true);
    setMaterialFeature(store, 'occlusion', true);
    // low-poly suggests no translucency: the library defaults.
    setMaterialFeature(store, 'translucency', true);
    expect(featuresOf(store.state.definition)).toEqual({
      crownNormals: 0.5,
      translucency: { strength: 0.5, edge: 0.5, ambient: 0.3 },
      occlusion: { strength: 0.8 },
    });
    expect(hasMaterialFeatures(store.state.definition)).toBe(true);

    setMaterialFeature(store, 'translucency', false);
    setMaterialFeature(store, 'crownNormals', false);
    expect(store.state.definition.materials.leaf).not.toHaveProperty('translucency');
    expect(store.state.definition.materials.leaf).not.toHaveProperty('crownNormals');
    expect(store.state.definition.materials.occlusion).toEqual({ strength: 0.8 });
  });

  it('keeps a feature that is already on when toggled on again (no history step)', async () => {
    const { store, history } = await editor('oak/stylized');
    setMaterialFeature(store, 'occlusion', true);
    store.editDefinition({ materials: { occlusion: { strength: 0.25 } } });
    const before = store.state;
    setMaterialFeature(store, 'occlusion', true);
    expect(store.state).toBe(before);
    history.undo();
    history.undo();
    expect(store.state.definition.materials).not.toHaveProperty('occlusion');
  });

  it('offers the suggestion of the Style the editor is in', async () => {
    expect(suggestedMaterialFeatures((await editor('oak/stylized')).store.state)).toEqual({
      style: 'stylized',
      features: { crownNormals: 1, translucency: { strength: 0.3, edge: 0.8, ambient: 0.2 }, occlusion: { strength: 0.9 } },
    });
    // Imported JSON: the Style its shading belongs to.
    const { store } = await editor('oak/low-poly');
    store.set({ source: 'mine.json' });
    expect(suggestedMaterialFeatures(store.state).style).toBe('low-poly');
  });

  it('applies the suggestion and Off as single undoable steps, keeping everything else', async () => {
    const { store, history } = await editor('oak/stylized');
    store.editDefinition({ trunk: { length: 6.5 } });
    const edited = store.state.definition;

    applyMaterialFeatures(store, suggestedMaterialFeatures(store.state).features);
    const suggested = store.state.definition;
    expect(featuresOf(suggested)).toEqual({
      crownNormals: 1,
      translucency: { strength: 0.3, edge: 0.8, ambient: 0.2 },
      occlusion: { strength: 0.9 },
    });
    expect(suggested.trunk.length).toBe(6.5);

    applyMaterialFeatures(store, {});
    expect(hasMaterialFeatures(store.state.definition)).toBe(false);
    expect(store.state.definition).toEqual(edited);

    history.undo();
    expect(store.state.definition).toEqual(suggested);
    history.undo();
    expect(store.state.definition).toEqual(edited);
    history.redo();
    expect(store.state.definition).toEqual(suggested);
  });

  it('records no history step when Off or the suggestion changes nothing', async () => {
    const { store, history } = await editor('oak/stylized');
    applyMaterialFeatures(store, {});
    expect(history.canUndo).toBe(false);
    applyMaterialFeatures(store, suggestedMaterialFeatures(store.state).features);
    const once = store.state;
    applyMaterialFeatures(store, suggestedMaterialFeatures(store.state).features);
    expect(store.state).toBe(once);
  });

  it('tells when an edit only retuned Material Features that stay on (the preview then needs no new tree)', async () => {
    const { store } = await editor('oak/stylized');
    const off = store.state.definition;
    applyMaterialFeatures(store, { crownNormals: 0.5, translucency: { strength: 0.3, edge: 0.8, ambient: 0.2 }, occlusion: { strength: 0.9 } });
    const on = store.state.definition;
    store.editDefinition({ materials: { occlusion: { strength: 0.3 } } });
    const occlusion = store.state.definition;
    store.editDefinition({ materials: { leaf: { crownNormals: 0.4 } } });
    const crown = store.state.definition;
    store.editDefinition({ materials: { leaf: { translucency: { edge: 0.1 } } } });
    const translucency = store.state.definition;
    store.editDefinition({ materials: { leaf: { roughness: 0.2 } } });
    const other = store.state.definition;
    setMaterialFeature(store, 'translucency', false);
    const switchedOff = store.state.definition;

    const tuned = { crownNormals: 0.4, translucency: { strength: 0.3, edge: 0.1, ambient: 0.2 }, occlusion: { strength: 0.3 } };
    expect(liveMaterialFeatureChange(on, occlusion)).toEqual({ ...tuned, crownNormals: 0.5, translucency: { ...tuned.translucency, edge: 0.8 } });
    expect(liveMaterialFeatureChange(occlusion, crown)).toEqual({ ...tuned, translucency: { ...tuned.translucency, edge: 0.8 } });
    expect(liveMaterialFeatureChange(crown, translucency)).toEqual(tuned);
    expect(liveMaterialFeatureChange(on, translucency)).toEqual(tuned); // several values at once (undo/redo)
    expect(liveMaterialFeatureChange(off, on)).toBeNull(); // switched on: a new tree
    expect(liveMaterialFeatureChange(translucency, switchedOff)).toBeNull(); // switched off
    expect(liveMaterialFeatureChange(translucency, other)).toBeNull(); // another parameter changed
    expect(liveMaterialFeatureChange(translucency, translucency)).toBeNull(); // nothing changed
  });

  it('treats Crown Normals going to or from 0 as switching them (a new tree)', async () => {
    const { store } = await editor('oak/stylized');
    applyMaterialFeatures(store, { crownNormals: 0.5 });
    const on = store.state.definition;
    store.editDefinition({ materials: { leaf: { crownNormals: 0 } } });
    const zero = store.state.definition;
    expect(liveMaterialFeatureChange(on, zero)).toBeNull();
    expect(liveMaterialFeatureChange(zero, on)).toBeNull();
  });
});
