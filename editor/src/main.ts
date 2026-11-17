// Tree Editor app: wires the store, the preview and the sidebar panels together.
// Built only on the library's public API (`@casmo/tree.js` and its Style subpaths).
// Query parameters: ?start=<style>/<form> (default: the first Style), ?seed=, ?growth=, ?season=,
// ?backend=webgl (WebGPURenderer's WebGL2 fallback).
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
  const start = params.get('start') ?? DEFAULT_START;
  const store = createEditorStore({
    definition: await loadStart(start),
    source: start,
    seed: optionalNumber('seed'),
    growth: optionalNumber('growth'),
    season: optionalNumber('season'),
  });

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
  window.treeEditor = { ...window.treeEditor, backend, store, preview };

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
