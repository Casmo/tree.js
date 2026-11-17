import type { Preview } from '../preview';
import type { EditorStore } from '../store';

/** What every panel gets: the store (read + write), the preview, and a place to report problems. */
export interface PanelContext {
  store: EditorStore;
  preview: Preview;
  /** Shows a message in the status line (null clears it). */
  report(message: string | null): void;
}

/** One section of the sidebar. Panels only talk to each other through the store. */
export interface Panel {
  id: string;
  title: string;
  render(context: PanelContext): HTMLElement;
}
