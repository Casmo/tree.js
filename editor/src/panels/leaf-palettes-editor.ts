// The Leaf Palettes editor in the Season Profile panel: palettes can be added and removed, and each
// one's leaf colour keyframes and accent colour edited. A line says which palette the current Seed
// picks (its leaf colours replace the Leaf colour track on that tree).
import { pickLeafPalette } from '@casmo/tree.js';
import { addLeafPalette, removeLeafPalette } from '../leaf-palettes';
import { followValue, reportEdit } from './block-panel';
import { colorControl, setDefinitionValue } from './controls';
import { LEAF_PALETTES } from './fields';
import { trackEditor } from './track-editor';
import type { PanelContext } from './types';

export function leafPalettesEditor(context: PanelContext): HTMLElement {
  const { store } = context;
  const root = document.createElement('div');
  root.className = 'leaf-palettes';
  root.id = 'leaf-palettes';
  const heading = document.createElement('h3');
  heading.textContent = LEAF_PALETTES.label;
  const note = document.createElement('p');
  note.className = 'hint';
  note.id = 'leaf-palettes-note';
  const list = document.createElement('div');
  const add = document.createElement('button');
  add.type = 'button';
  add.id = 'add-leaf-palette';
  add.textContent = 'Add Leaf Palette';
  add.addEventListener('click', () => reportEdit(context, () => addLeafPalette(store)));
  root.append(heading, note, list, add);

  const palettes = () => store.state.definition.season.leafPalettes ?? [];
  followValue(
    context,
    // Rebuilt when the number of palettes changes; edits inside a palette update its own controls.
    () => palettes().length,
    () =>
      list.replaceChildren(
        ...palettes().map((_, i) => {
          const name = `Palette ${i + 1}`;
          const path = `${LEAF_PALETTES.path}.${i}`;
          const fieldset = document.createElement('fieldset');
          fieldset.className = 'leaf-palette';
          fieldset.id = `leaf-palette-${i}`;
          const legend = document.createElement('legend');
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'remove';
          remove.id = `remove-leaf-palette-${i}`;
          remove.textContent = 'Remove';
          remove.setAttribute('aria-label', `Remove Leaf ${name}`);
          remove.addEventListener('click', () => reportEdit(context, () => removeLeafPalette(store, i)));
          legend.append(name, remove);
          const accent = colorControl(context, {
            id: `${path}.accent`,
            label: 'Accent',
            get: (state) => state.definition.season.leafPalettes?.[i]?.accent ?? '#000000',
            set: (target, value) => setDefinitionValue(target, `${path}.accent`, value),
          });
          // A short visible label; the full accessible name.
          accent.querySelector('input')!.setAttribute('aria-label', `${name} ${LEAF_PALETTES.accent}`);
          fieldset.append(
            legend,
            accent,
            trackEditor(context, {
              path: `${path}.leafColor`,
              id: `track-leafPalettes-${i}`,
              label: `${name} ${LEAF_PALETTES.leafColor}`,
              kind: 'color',
              tName: 'Season',
              addAt: (state) => state.season,
              addHint: 'Adds a keyframe at the preview Season',
            }),
          );
          return fieldset;
        }),
      ),
    () => {
      const all = palettes();
      const picked = pickLeafPalette(store.state.definition, store.state.seed);
      note.textContent =
        all.length === 0 || !picked
          ? 'None: every tree uses the Leaf colour track. A Seed picks one of several palettes (its leaf colours and accent).'
          : `Seed ${store.state.seed} picks Palette ${all.indexOf(picked) + 1} of ${all.length}; its leaf colours replace the Leaf colour track.`;
    },
  );
  return root;
}
