import { describe, expect, it } from 'vitest';
import { loadStyle, parseDefinition } from '@casmo/tree.js';
import { definitionToJson } from './export-json';
import { createHistory } from './history';
import { loadStart } from './starts';
import { createEditorStore } from './store';
import { switchStyle } from './style-switch';

/** An editor started from `id`, with undo history on a frozen clock (so edits could merge). */
async function editor(id: string) {
  const store = createEditorStore({ definition: await loadStart(id), source: id, seed: 1 });
  const history = createHistory(store, { now: () => 0 });
  return { store, history };
}

describe('Style switch', () => {
  it('re-applies only the look and keeps shape edits', async () => {
    const { store } = await editor('oak/low-poly');
    store.editDefinition({ trunk: { length: 7.2, stems: 2 } });
    store.editDefinition({ branches: [{ ...store.state.definition.branches[0]!, lengthProfile: [{ t: 0, value: 1 }, { t: 1, value: 0.3 }] }] });
    store.set({ season: 0.6 });
    const edited = store.state.definition;

    await switchStyle(store, 'realistic');

    const { definition } = store.state;
    expect(definition.materials.shading).toBe('standard');
    expect(definition.leaves.shape).toBe('card');
    expect(definition.trunk).toMatchObject({ length: 7.2, stems: 2 });
    expect(definition.branches[0]!.lengthProfile).toEqual([{ t: 0, value: 1 }, { t: 1, value: 0.3 }]);
    expect(definition.season).toEqual(edited.season);
    expect(definition.species).toBe('oak');
    expect(definition).toEqual((await loadStyle('realistic')).apply(edited));
    expect(store.state).toMatchObject({ source: 'oak/realistic', season: 0.6 });
  });

  it('is one undoable history step, every time', async () => {
    const { store, history } = await editor('broadleaf/low-poly');
    store.editDefinition({ trunk: { length: 6 } });
    const edited = store.state;

    await switchStyle(store, 'stylized');
    const stylized = store.state;
    await switchStyle(store, 'realistic');
    expect(store.state.source).toBe('broadleaf/realistic');

    history.undo();
    expect(store.state).toEqual(stylized);
    history.undo();
    expect(store.state).toEqual(edited);
    expect(store.state.definition.materials.shading).toBe('flat');
    history.redo();
    expect(store.state).toEqual(stylized);
  });

  it('works on an old start id and on imported Definitions', async () => {
    const old = await editor('low-poly/conifer');
    await switchStyle(old.store, 'stylized');
    expect(old.store.state.source).toBe('conifer/stylized');

    const imported = createEditorStore({ definition: await loadStart('oak/stylized'), source: 'my-oak.tree.json' });
    await switchStyle(imported, 'low-poly');
    expect(imported.state.source).toBe('my-oak.tree.json');
    expect(imported.state.definition.materials.shading).toBe('flat');
  });

  it('does nothing when the Style is already the current one', async () => {
    const { store, history } = await editor('oak/stylized');
    await switchStyle(store, 'stylized');
    expect(history.canUndo).toBe(false);
  });

  it('to Painterly: the tree shrinks to its Painterly size, keeps its shape, and the export keeps the size', async () => {
    const { store, history } = await editor('oak/realistic');
    store.editDefinition({ trunk: { stems: 2 } });
    const realistic = store.state.definition;

    await switchStyle(store, 'painterly');
    const painterly = store.state.definition;
    expect(store.state.source).toBe('oak/painterly');
    expect(painterly).toMatchObject({ species: 'oak', materials: { shading: 'painted' }, leaves: { shape: 'mass' }, trunk: { stems: 2 } });
    expect(painterly).toEqual((await loadStyle('painterly')).apply(realistic));
    expect(painterly.trunk.length).toBeLessThan(realistic.trunk.length * 0.5); // a ~14 m oak drawn about 3 m tall

    // The exported JSON is the small tree; loaded back (or Painterly applied again) it does not shrink twice.
    const exported = parseDefinition(definitionToJson(painterly));
    expect(exported).toEqual(painterly);
    expect((await loadStyle('painterly')).apply(exported).trunk).toEqual(painterly.trunk);
    const imported = createEditorStore({ definition: exported, source: 'oak.tree.json' });
    await switchStyle(imported, 'painterly');
    expect(imported.state.definition).toEqual(exported);

    // Back to another Style: the size stays the Painterly one (accepted), and Painterly again keeps it.
    await switchStyle(store, 'stylized');
    const size = ({ trunk: { length, radius }, leaves }: typeof painterly) => ({ length, radius, leaves: leaves.size });
    expect(store.state.definition.materials.shading).toBe('toon');
    expect(size(store.state.definition)).toMatchObject({ length: painterly.trunk.length, radius: painterly.trunk.radius });
    await switchStyle(store, 'painterly');
    expect(size(store.state.definition)).toEqual(size(painterly));

    history.undo();
    history.undo();
    history.undo();
    expect(store.state.definition).toEqual(realistic);
  });
});
