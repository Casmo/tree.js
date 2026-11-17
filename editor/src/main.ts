// Tree Editor app: wires the store, the preview and the sidebar panels together.
// Built only on the library's public API (`@casmo/tree.js` and its Style subpaths).
// Query parameters: ?start=<style>/<form> (default: the autosaved work, else the first Style), ?seed=,
// ?growth=, ?season=, ?backend=webgl (WebGPURenderer's WebGL2 fallback).
import { loadAutosave, startAutosave } from './autosave';
import { createHistory, type EditorHistory } from './history';
import { bindHistoryShortcuts, historyButtons } from './history-controls';
import { PANELS, type PanelContext } from './panels';
import { Preview, type PreviewStatus } from './preview';
import { DEFAULT_START, loadStart } from './starts';
import { createEditorStore, type EditorStore } from './store';

declare global {
  interface Window {
    /** Editor handle for tests and debugging. */
    treeEditor: {
      status: PreviewStatus;
      backend?: string;
      error?: string;
      store?: EditorStore;
      history?: EditorHistory;
      preview?: Preview;
    };
  }
}

window.treeEditor = { status: 'loading' };
const params = new URLSearchParams(location.search);
const statusEl = document.getElementById('status')!;

function report(message: string | null, isError = message !== null && !message.startsWith('Imported')): void {
  statusEl.textContent = message ?? '';
  statusEl.classList.toggle('error', isError);
}

function optionalNumber(name: string): number | undefined {
  const value = params.get(name);
  return value === null ? undefined : Number(value);
}

async function main(): Promise<void> {
  // An explicit ?start= begins anew; otherwise continue the autosaved work (if any).
  const start = params.get('start');
  const saved = start === null ? loadAutosave(localStorage) : null;
  const base = saved ?? { definition: await loadStart(start ?? DEFAULT_START), source: start ?? DEFAULT_START };
  const store = createEditorStore({
    ...base,
    seed: optionalNumber('seed') ?? base.seed,
    growth: optionalNumber('growth') ?? base.growth,
    season: optionalNumber('season') ?? base.season,
  });
  startAutosave(store, localStorage);
  // The URL's starting point is now in the autosave: drop it so a reload continues the work.
  const kept = new URLSearchParams(location.search);
  for (const name of ['start', 'seed', 'growth', 'season']) kept.delete(name);
  window.history.replaceState(null, '', `${location.pathname}${kept.size ? `?${kept}` : ''}${location.hash}`);
  const history = createHistory(store);
  bindHistoryShortcuts(window, history);
  document.querySelector('#sidebar header')!.after(historyButtons(history));

  const preview = new Preview(document.getElementById('preview')!, {
    forceWebGL: params.get('backend') === 'webgl',
    onStatus: (status, error) => {
      window.treeEditor.status = status;
      if (error) {
        window.treeEditor.error = error.message;
        report(error.message);
        console.error(error);
      }
    },
  });
  const backend = await preview.init();
  window.treeEditor = { ...window.treeEditor, backend, store, history, preview };

  const context: PanelContext = { store, preview, report: (message) => report(message) };
  const panels = document.getElementById('panels')!;
  for (const panel of PANELS) {
    const section = document.createElement('section');
    section.id = `panel-${panel.id}`;
    const heading = document.createElement('h2');
    heading.textContent = panel.title;
    section.append(heading, panel.render(context));
    panels.append(section);
  }

  preview.connect(store);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  report(message, true);
  window.treeEditor = { status: 'error', error: message };
  console.error(error);
});
