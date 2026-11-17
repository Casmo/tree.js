// Export the Definition as versioned JSON (a download). Baked glTF export (#21) goes here too.
import { definitionFileName, definitionToJson } from '../export-json';
import type { Panel } from './types';

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
    root.append(button);
    return root;
  },
};
