// Start from a built-in Style/Form or import a JSON Tree Definition.
import { loadStart, STARTS } from '../starts';
import { errorMessage } from './controls';
import type { Panel } from './types';

export const IMPORTED = 'imported';

export const startPanel: Panel = {
  id: 'start',
  title: 'Start from',
  render(context) {
    const { store } = context;
    const root = document.createElement('div');

    const label = document.createElement('label');
    label.htmlFor = 'start';
    label.textContent = 'Style / Form';
    const select = document.createElement('select');
    select.id = 'start';
    for (const start of STARTS) select.add(new Option(start.label, start.id));
    const imported = new Option('Imported JSON', IMPORTED);
    imported.disabled = true;
    select.add(imported);
    select.addEventListener('change', () => {
      const id = select.value;
      loadStart(id).then(
        (definition) => {
          store.loadDefinition(definition, id);
          context.report(null);
        },
        (error: unknown) => context.report(errorMessage(error)),
      );
    });

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Import JSON…';
    const file = document.createElement('input');
    file.type = 'file';
    file.id = 'import-json';
    file.accept = '.json,application/json';
    file.hidden = true;
    importButton.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (!chosen) return;
      try {
        store.loadDefinition(await chosen.text(), chosen.name);
        context.report(`Imported ${chosen.name}`);
      } catch (error) {
        context.report(`Could not import ${chosen.name}: ${errorMessage(error)}`);
      }
    });

    const sync = (): void => {
      const source = store.state.source;
      select.value = STARTS.some((start) => start.id === source) ? source : IMPORTED;
    };
    store.subscribe(sync);
    sync();

    const row = document.createElement('div');
    row.className = 'control';
    row.append(label, select);
    root.append(row, importButton, file);
    return root;
  },
};
