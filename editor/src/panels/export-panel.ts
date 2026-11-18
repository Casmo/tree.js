// Export the Definition as versioned JSON, or the tree on show as a Baked Tree (static .glb) - downloads -
// or copy a code snippet (Definition inline + the preview's Seed, Growth and Season).
import { exportBakedTree } from '@casmo/tree.js';
import { treeCodeSnippet, type CodeTarget } from '../export-code';
import { definitionFileName, definitionToJson } from '../export-json';
import type { Panel, PanelContext } from './types';

export function download(fileName: string, contents: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const exportPanel: Panel = {
  id: 'export',
  title: 'Export',
  render(context) {
    const root = document.createElement('div');
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'export-json';
    button.textContent = 'Export JSON';
    button.addEventListener('click', () => {
      const { definition } = context.store.state;
      download(definitionFileName(definition), definitionToJson(definition), 'application/json');
    });
    root.append(button, bakedGltfButton(context), copyCode(context));
    return root;
  },
};

/** Exports the previewed tree at the current Seed, Growth and Season as a Baked Tree `.glb`. */
function bakedGltfButton(context: PanelContext): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'export-gltf';
  button.textContent = 'Export glTF';
  button.title = 'Baked Tree: static geometry at the current Seed, Growth and Season (.glb)';
  button.addEventListener('click', async () => {
    const tree = context.preview.tree;
    if (!tree) return;
    const { definition, growth, season } = context.store.state;
    try {
      const glb = await exportBakedTree(tree, { growth, season });
      download(definitionFileName(definition).replace(/\.tree\.json$/, '.glb'), glb, 'model/gltf-binary');
    } catch (error) {
      context.report(`glTF export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return button;
}

const CODE_TABS: { target: CodeTarget; label: string }[] = [
  { target: 'three', label: 'three.js' },
  { target: 'react', label: 'React' },
];

/** "Copy code": vanilla three.js / React tabs over a read-only preview that follows the store. */
function copyCode(context: PanelContext): HTMLElement {
  const { store } = context;
  let target: CodeTarget = 'three';
  const root = document.createElement('div');
  root.className = 'copy-code';
  const heading = document.createElement('h3');
  heading.textContent = 'Code';

  const tabs = document.createElement('div');
  tabs.className = 'code-tabs';
  tabs.setAttribute('role', 'tablist');
  const preview = document.createElement('textarea');
  preview.id = 'export-code';
  preview.readOnly = true;
  preview.spellcheck = false;
  preview.wrap = 'off';
  preview.rows = 12;
  preview.setAttribute('aria-label', 'Code preview');

  const tabButtons = CODE_TABS.map(({ target: tabTarget, label }) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.textContent = label;
    tab.addEventListener('click', () => {
      target = tabTarget;
      sync();
    });
    return tab;
  });
  tabs.append(...tabButtons);

  const sync = (): void => {
    tabButtons.forEach((tab, index) => tab.setAttribute('aria-selected', String(CODE_TABS[index]!.target === target)));
    preview.value = treeCodeSnippet(store.state, target);
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (!root.isConnected) return unsubscribe();
    const { definition, seed, growth, season } = state;
    if (definition !== previous.definition || seed !== previous.seed || growth !== previous.growth || season !== previous.season) sync();
  });
  sync();

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.id = 'copy-code';
  copy.textContent = 'Copy code';
  copy.title = 'Imports, the full Definition inline and the current Seed, Growth and Season';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(preview.value);
      context.report('Copied the code to the clipboard.');
    } catch (error) {
      context.report(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  root.append(heading, tabs, preview, copy);
  return root;
}
