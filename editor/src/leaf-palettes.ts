// Leaf Palettes (`season.leafPalettes`) in the editor: adding and removing a palette. Each is one
// store change, so one undoable history step. Adding the first palette and removing the last keep
// the colours on show: the first copies the Leaf colour track, the last one's colours go back to it.
// Keyframe and accent edits are plain path edits (`season.leafPalettes.<i>.leafColor...`).
import type { LeafPalette } from '@casmo/tree.js';
import { setAt } from './definition-path';
import type { EditorStore } from './store';

const copy = (palette: LeafPalette): LeafPalette => ({ leafColor: palette.leafColor.map((key) => ({ ...key })), accent: palette.accent });

/** Adds a palette: a copy of the last one, or (the first) the Leaf colour track with its first colour as accent. */
export function addLeafPalette(store: EditorStore): void {
  const { season } = store.state.definition;
  const palettes = season.leafPalettes ?? [];
  const next = palettes.at(-1) ?? { leafColor: season.leafColor, accent: season.leafColor[0]!.value };
  store.set({ definition: setAt(store.state.definition, 'season.leafPalettes', [...palettes.map(copy), copy(next)]) });
}

/** Removes palette `index`; removing the last one removes the field and puts its colours on the Leaf colour track. */
export function removeLeafPalette(store: EditorStore, index: number): void {
  const { definition } = store.state;
  const palettes = definition.season.leafPalettes ?? [];
  const removed = palettes[index];
  if (!removed) throw new RangeError(`No Leaf Palette ${index}`);
  const rest = palettes.filter((_, i) => i !== index);
  const season = { ...definition.season };
  delete season.leafPalettes;
  store.set({
    definition: setAt(
      definition,
      'season',
      rest.length > 0 ? { ...season, leafPalettes: rest.map(copy) } : { ...season, leafColor: removed.leafColor.map((key) => ({ ...key })) },
    ),
  });
}
