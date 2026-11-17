// Undo/redo for the Tree Editor: a list of store snapshots taken around every change.
// Every edit goes through the store, so the history only listens to it and restores snapshots
// with `store.set`; panels need no undo-specific code. A burst of changes to the same parameter
// (dragging a slider, typing) becomes one step.
import type { EditorState, EditorStore } from './store';

export interface EditorHistory {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Restores the state before the last step; false when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the last undone step; false when there is nothing to redo. */
  redo(): boolean;
  /** Calls `listener` whenever the history changes (e.g. to enable undo/redo buttons). */
  subscribe(listener: () => void): () => void;
}

export interface HistoryOptions {
  /** Most steps kept (the oldest are forgotten). Default 200. */
  limit?: number;
  /** Changes to the same parameter less than this many ms apart merge into one step. Default 800. */
  mergeWithinMs?: number;
  /** Clock (tests). */
  now?: () => number;
}

export function createHistory(store: EditorStore, options: HistoryOptions = {}): EditorHistory {
  const { limit = 200, mergeWithinMs = 800, now = () => performance.now() } = options;
  const past: EditorState[] = [];
  let future: EditorState[] = [];
  const listeners = new Set<() => void>();
  let restoring = false;
  /** What the last recorded change touched, and when; null after undo/redo so new edits start a new step. */
  let last: { key: string; time: number } | null = null;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  store.subscribe((state, previous) => {
    if (restoring) return;
    const key = changeKey(previous, state);
    const time = now();
    const merge = last !== null && last.key === key && time - last.time < mergeWithinMs && future.length === 0;
    last = { key, time };
    if (merge) return;
    past.push(previous);
    if (past.length > limit) past.shift();
    future = [];
    notify();
  });

  const restore = (from: EditorState[], to: EditorState[]): boolean => {
    const snapshot = from.pop();
    if (!snapshot) return false;
    to.push(store.state);
    restoring = true;
    try {
      store.set(snapshot);
    } finally {
      restoring = false;
    }
    last = null;
    notify();
    return true;
  };

  return {
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    undo: () => restore(past, future),
    redo: () => restore(future, past),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Which parameters a change touched: state fields plus dotted Definition paths, e.g. "definition:trunk.length". */
function changeKey(previous: EditorState, state: EditorState): string {
  const keys: string[] = [];
  for (const field of Object.keys(state) as (keyof EditorState)[]) {
    if (previous[field] === state[field]) continue;
    if (field === 'definition') keys.push(...changedPaths(previous.definition, state.definition, '').map((p) => `definition:${p}`));
    else keys.push(field);
  }
  return keys.join(',');
}

function changedPaths(a: unknown, b: unknown, path: string): string[] {
  if (Object.is(a, b)) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return [path];
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return [path];
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  return [...keys].flatMap((key) => changedPaths(objA[key], objB[key], path ? `${path}.${key}` : key));
}
