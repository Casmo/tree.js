// Export the Definition as versioned JSON, or the tree on show as a Baked Tree (static .glb) - downloads.
import { exportBakedTree } from '@casmo/tree.js';
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
    root.append(button, bakedGltfButton(context));
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
