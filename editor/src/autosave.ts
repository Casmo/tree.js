// Autosave: the editor's current state is written to browser storage after every change and
// restored on the next visit, so a refresh loses nothing. The saved Definition goes through
// parseDefinition on load (older schema versions migrate; anything unreadable is ignored).
import { parseDefinition } from '@casmo/tree.js';
import type { EditorState, EditorStore, EditorStoreInit } from './store';

export const AUTOSAVE_KEY = 'tree-editor:autosave';

interface SavedEditor {
  version: 1;
  state: Pick<EditorState, 'definition' | 'seed' | 'growth' | 'season' | 'source'>;
}

function save(storage: Storage, state: EditorState): void {
  const { definition, seed, growth, season, source } = state;
  const saved: SavedEditor = { version: 1, state: { definition, seed, growth, season, source } };
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(saved));
  } catch (error) {
    console.warn('Tree Editor: could not autosave', error); // full or disabled storage: keep editing
  }
}

/** Saves the store's state now and after every change; returns the stop function. */
export function startAutosave(store: EditorStore, storage: Storage): () => void {
  save(storage, store.state);
  return store.subscribe((state) => save(storage, state));
}

/** The last autosaved state, or null when there is none (or it can't be read). */
export function loadAutosave(storage: Storage): EditorStoreInit | null {
  try {
    const json = storage.getItem(AUTOSAVE_KEY);
    if (json === null) return null;
    const { state } = JSON.parse(json) as Partial<SavedEditor>;
    if (!state) return null;
    const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
    return {
      definition: parseDefinition(state.definition),
      seed: number(state.seed),
      growth: number(state.growth),
      season: number(state.season),
      source: typeof state.source === 'string' ? state.source : undefined,
    };
  } catch {
    return null;
  }
}
