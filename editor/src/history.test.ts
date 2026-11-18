import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION } from '@casmo/tree.js';
import { createEditorStore } from './store';
import { createHistory } from './history';

const setup = () => {
  let time = 0;
  const store = createEditorStore({ definition: DEFAULT_DEFINITION, seed: 1 });
  const history = createHistory(store, { now: () => time });
  const later = (ms = 10_000) => (time += ms);
  return { store, history, later };
};

describe('editor history', () => {
  it('undoes and redoes every kind of edit', () => {
    const { store, history, later } = setup();
    const initial = store.state;
    store.editDefinition({ trunk: { length: 7.5 } });
    later();
    store.set({ seed: 9 });
    later();
    store.loadDefinition({ ...DEFAULT_DEFINITION, name: 'Imported' }, 'file.json');
    const last = store.state;

    expect(history.undo()).toBe(true);
    expect(store.state.source).toBe('');
    expect(store.state.seed).toBe(9);
    history.undo();
    expect(store.state.seed).toBe(1);
    expect(store.state.definition.trunk.length).toBe(7.5);
    history.undo();
    expect(store.state).toEqual(initial);
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBe(false);

    history.redo();
    history.redo();
    history.redo();
    expect(store.state).toEqual(last);
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it('a new edit after undo discards the redo branch', () => {
    const { store, history, later } = setup();
    store.set({ seed: 2 });
    later();
    store.set({ seed: 3 });
    history.undo();
    store.set({ growth: 0.5 });
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(store.state).toMatchObject({ seed: 2, growth: 1 });
  });

  it('merges a burst of changes to the same parameter (dragging a slider) into one step', () => {
    const { store, history, later } = setup();
    for (const growth of [0.9, 0.8, 0.7, 0.6]) {
      store.set({ growth });
      later(50);
    }
    store.set({ season: 0.9 }); // another parameter: its own step
    later(50);
    store.editDefinition({ trunk: { length: 6 } });
    later(50);
    store.editDefinition({ trunk: { radius: 0.4 } }); // another Definition parameter
    history.undo();
    expect(store.state.definition.trunk).toMatchObject({ length: 6, radius: DEFAULT_DEFINITION.trunk.radius });
    history.undo();
    expect(store.state.definition.trunk.length).toBe(DEFAULT_DEFINITION.trunk.length);
    history.undo();
    expect(store.state).toMatchObject({ growth: 0.6, season: 0.37 });
    history.undo();
    expect(store.state.growth).toBe(1);
    expect(history.canUndo).toBe(false);
  });

  it('never merges changes of starting point or Style, however quick', () => {
    const { store, history } = setup();
    store.loadDefinition(DEFAULT_DEFINITION, 'broadleaf/low-poly');
    store.loadDefinition(DEFAULT_DEFINITION, 'broadleaf/stylized');
    history.undo();
    expect(store.state.source).toBe('broadleaf/low-poly');
  });

  it('keeps separate steps for the same parameter when edits are apart in time', () => {
    const { store, history, later } = setup();
    store.set({ seed: 2 });
    later();
    store.set({ seed: 3 });
    history.undo();
    expect(store.state.seed).toBe(2);
  });

  it('tells listeners when undo/redo availability changes and forgets the oldest steps beyond the limit', () => {
    let time = 0;
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    const history = createHistory(store, { now: () => (time += 10_000), limit: 3 });
    const seen: [boolean, boolean][] = [];
    history.subscribe(() => seen.push([history.canUndo, history.canRedo]));
    for (const seed of [2, 3, 4, 5, 6]) store.set({ seed });
    while (history.undo());
    expect(store.state.seed).toBe(3);
    expect(seen.at(0)).toEqual([true, false]);
    expect(seen.at(-1)).toEqual([false, true]);
  });
});
