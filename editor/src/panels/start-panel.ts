// Start from a Species (or a generic Form) in a Style, or import a JSON Tree Definition.
// Picking a Species starts anew; picking a Style re-styles the current Definition, keeping its shape.
import type { StyleName } from '@casmo/tree.js';
import { loadStart, parseStartId, SPECIES_GROUPS, STYLE_CHOICES, treeChoice } from '../starts';
import { currentStyle, switchStyle } from '../style-switch';
import { errorMessage } from './controls';
import type { Panel } from './types';

export const IMPORTED = 'imported';

function picker(id: string, text: string, select: HTMLSelectElement): HTMLDivElement {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = text;
  select.id = id;
  const row = document.createElement('div');
  row.className = 'control';
  row.append(label, select);
  return row;
}

export const startPanel: Panel = {
  id: 'start',
  title: 'Start from',
  render(context) {
    const { store } = context;
    const root = document.createElement('div');

    const species = document.createElement('select');
    for (const group of SPECIES_GROUPS) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.label;
      for (const choice of group.species) optgroup.append(new Option(choice.label, choice.id));
      species.append(optgroup);
    }
    const imported = new Option('Imported JSON', IMPORTED);
    imported.disabled = true;
    species.add(imported);

    const style = document.createElement('select');
    for (const choice of STYLE_CHOICES) style.add(new Option(choice.label, choice.id));

    species.addEventListener('change', () => {
      const id = `${species.value}/${style.value}`;
      loadStart(id).then(
        (definition) => {
          store.loadDefinition(definition, id);
          context.report(null);
        },
        (error: unknown) => context.report(errorMessage(error)),
      );
    });
    style.addEventListener('change', () => {
      switchStyle(store, style.value as StyleName).then(
        () => context.report(null),
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
      const start = parseStartId(store.state.source);
      species.value = start ? treeChoice(start.tree) : IMPORTED;
      style.value = currentStyle(store.state);
    };
    store.subscribe(sync);
    sync();

    root.append(picker('start-species', 'Species', species), picker('start-style', 'Style', style), importButton, file);
    return root;
  },
};
