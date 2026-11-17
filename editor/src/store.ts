// The editor's single source of truth: the Tree Definition being designed plus the preview's
// Seed, Growth and Season. Every panel writes through this store and every view subscribes to it.
// States are immutable snapshots (a new object per change; `definition` is replaced, never
// mutated), so undo/redo can keep a list of them and autosave can serialise one.
import { extendDefinition, parseDefinition, type DefinitionPatch, type TreeDefinition } from '@casmo/tree.js';

export interface EditorState {
  /** The Tree Definition being designed (always complete and valid). */
  readonly definition: TreeDefinition;
  /** The preview's Seed (non-negative integer). Not part of the Definition. */
  readonly seed: number;
  /** The preview's Growth, 0..1. */
  readonly growth: number;
  /** The preview's Season, 0..1. */
  readonly season: number;
  /** Where the Definition came from (a Style/Form label or an imported file name). */
  readonly source: string;
}

export type EditorListener = (state: EditorState, previous: EditorState) => void;

export interface EditorStore {
  /** The current state (a frozen snapshot; replaced on every change). */
  readonly state: EditorState;
  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe(listener: EditorListener): () => void;
  /**
   * Replaces any fields of the state. Seed is floored to a non-negative integer, Growth and
   * Season are clamped to 0..1, a Definition is validated (throws TreeDefinitionError).
   * This is also how undo/redo restores a snapshot.
   */
  set(partial: Partial<EditorState>): void;
  /** Changes some parameters of the Definition (deep merge, arrays replace); throws on invalid values. */
  editDefinition(patch: DefinitionPatch): void;
  /** Starts over from a Definition object or JSON string (older schema versions are migrated). */
  loadDefinition(input: unknown, source: string): void;
}

export interface EditorStoreInit {
  definition: TreeDefinition;
  seed?: number;
  growth?: number;
  season?: number;
  source?: string;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function normalise(state: EditorState): EditorState {
  return Object.freeze({
    ...state,
    seed: Math.max(0, Math.floor(state.seed)),
    growth: clamp01(state.growth),
    season: clamp01(state.season),
  });
}

function sameState(a: EditorState, b: EditorState): boolean {
  return (Object.keys(a) as (keyof EditorState)[]).every((key) => a[key] === b[key]);
}

export function createEditorStore(init: EditorStoreInit): EditorStore {
  let state = normalise({
    definition: parseDefinition(init.definition),
    seed: init.seed ?? 1,
    growth: init.growth ?? 1,
    season: init.season ?? 0.37,
    source: init.source ?? '',
  });
  const listeners = new Set<EditorListener>();

  const set = (partial: Partial<EditorState>): void => {
    const definition =
      partial.definition && partial.definition !== state.definition ? parseDefinition(partial.definition) : state.definition;
    const next = normalise({ ...state, ...partial, definition });
    if (sameState(next, state)) return;
    const previous = state;
    state = next;
    for (const listener of listeners) listener(state, previous);
  };

  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    editDefinition(patch) {
      set({ definition: extendDefinition(state.definition, patch) });
    },
    loadDefinition(input, source) {
      set({ definition: parseDefinition(input), source });
    },
  };
}
