import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, DEFAULT_DEFINITION } from '@casmo/tree.js';
import { createEditorStore } from './store';
import { AUTOSAVE_KEY, loadAutosave, startAutosave } from './autosave';

/** In-memory stand-in for localStorage. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
}

describe('editor autosave', () => {
  it('restores the last state in a new session', () => {
    const storage = memoryStorage();
    const store = createEditorStore({ definition: DEFAULT_DEFINITION, source: 'low-poly/broadleaf' });
    startAutosave(store, storage);
    store.editDefinition({ name: 'My oak', trunk: { length: 4.2 } });
    store.set({ seed: 7, growth: 0.4, season: 0.8 });

    const restored = createEditorStore(loadAutosave(storage)!);
    expect(restored.state).toEqual(store.state);
  });

  it('has nothing to restore when nothing was saved, or the save is unreadable', () => {
    const storage = memoryStorage();
    expect(loadAutosave(storage)).toBeNull();
    storage.setItem(AUTOSAVE_KEY, '{not json');
    expect(loadAutosave(storage)).toBeNull();
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({ state: { definition: { schemaVersion: 2, trunk: { length: -1 } }, seed: 1 } }));
    expect(loadAutosave(storage)).toBeNull();
  });

  it('migrates a Definition saved with an older schema version', () => {
    const storage = memoryStorage();
    const old = { schemaVersion: 1, trunk: { length: 3.5 }, bark: { color: '#664422' } };
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({ state: { definition: old, seed: 3, growth: 0.5, season: 0.2, source: 'old.json' } }));
    const init = loadAutosave(storage)!;
    expect(init).toMatchObject({ seed: 3, growth: 0.5, season: 0.2, source: 'old.json' });
    expect(init.definition).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, trunk: { length: 3.5 } });
  });

  it('keeps editing when the browser refuses to store (quota, private mode)', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    startAutosave(store, storage);
    expect(() => store.set({ seed: 5 })).not.toThrow();
  });

  it('stops saving when stopped', () => {
    const storage = memoryStorage();
    const store = createEditorStore({ definition: DEFAULT_DEFINITION });
    const stop = startAutosave(store, storage);
    store.set({ seed: 5 });
    stop();
    store.set({ seed: 6 });
    expect(loadAutosave(storage)?.seed).toBe(5);
  });
});
