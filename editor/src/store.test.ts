import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION, TreeDefinitionError } from '@casmo/tree.js';
import { createEditorStore } from './store';

describe('editor store', () => {
  it('starts from a Definition with Seed 1, fully grown, in summer', () => {
    const store = createEditorStore({ definition: DEFAULT_DEFINITION, source: 'Default' });
    expect(store.state).toMatchObject({ seed: 1, growth: 1, season: 0.37, source: 'Default' });
    expect(store.state.definition).toEqual(DEFAULT_DEFINITION);
  });

  it('edits a parameter of the Definition and tells listeners what changed', () => {
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    const seen: [number, number][] = [];
    store.subscribe((state, previous) => seen.push([previous.definition.trunk.length, state.definition.trunk.length]));
    store.editDefinition({ trunk: { length: 7.5 } });
    expect(store.state.definition.trunk.length).toBe(7.5);
    expect(seen).toEqual([[DEFAULT_DEFINITION.trunk.length, 7.5]]);
  });

  it('rejects an invalid edit and keeps the state', () => {
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    const before = store.state;
    expect(() => store.editDefinition({ trunk: { length: -1 } })).toThrow(TreeDefinitionError);
    expect(store.state).toBe(before);
  });

  it('keeps Seed a non-negative integer and Growth/Season within 0..1', () => {
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    store.set({ seed: 12.7, growth: 1.4, season: -0.2 });
    expect(store.state).toMatchObject({ seed: 12, growth: 1, season: 0 });
    store.set({ seed: -3 });
    expect(store.state.seed).toBe(0);
  });

  it('loads JSON (migrating old versions) as the new starting point', () => {
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    store.loadDefinition('{"schemaVersion": 1, "trunk": {"length": 3}}', 'old.json');
    expect(store.state.definition.schemaVersion).toBe(DEFAULT_DEFINITION.schemaVersion);
    expect(store.state.definition.trunk.length).toBe(3);
    expect(store.state.source).toBe('old.json');
  });

  it('only notifies listeners when something changed, and stops after unsubscribe', () => {
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ growth: 1 });
    expect(calls).toBe(0);
    store.set({ growth: 0.5 });
    off();
    store.set({ growth: 0.2 });
    expect(calls).toBe(1);
  });
});
