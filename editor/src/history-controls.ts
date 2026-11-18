// Undo/Redo buttons and keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) for the editor history.
import type { EditorHistory } from './history';

export type HistoryAction = 'undo' | 'redo';

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The history action a key press asks for, if any. */
export function historyShortcut(event: ShortcutKey): HistoryAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/** Text fields where Ctrl+Z keeps undoing the typed text (the browser's own undo). */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && ['text', 'search', 'email', 'url'].includes(target.type);
}

/** Handles the undo/redo shortcuts on `target` (the window); returns the unbind function. */
export function bindHistoryShortcuts(target: Window, history: EditorHistory): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const action = historyShortcut(event);
    if (!action || isTextField(event.target)) return;
    event.preventDefault();
    // A focused control commits its pending value on blur and only re-syncs once unfocused.
    if (event.target instanceof HTMLInputElement) event.target.blur();
    history[action]();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

/** Undo and Redo buttons, disabled when there is nothing to undo/redo. */
export function historyButtons(history: EditorHistory): HTMLElement {
  const root = document.createElement('div');
  root.className = 'history';
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';
  const button = (action: HistoryAction, label: string, shortcut: string): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.id = action;
    element.textContent = label;
    element.title = `${label} (${shortcut})`;
    element.addEventListener('click', () => history[action]());
    return element;
  };
  const undo = button('undo', 'Undo', `${mod}Z`);
  const redo = button('redo', 'Redo', isMac ? '⇧⌘Z' : 'Ctrl+Y');
  const sync = (): void => {
    undo.disabled = !history.canUndo;
    redo.disabled = !history.canRedo;
  };
  history.subscribe(sync);
  sync();
  root.append(undo, redo);
  return root;
}
