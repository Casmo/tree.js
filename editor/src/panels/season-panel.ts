// Season Profile: the leaf colour, leaf coverage and blossom keyframe tracks plus the blossom colour,
// and (while the tree has Fruit) the Fruit amount and Fruit colour tracks. Keyframes are added at the
// preview's current Season. A strip under each track shows it across the year. Then the Leaf Palettes.
import { fieldControl } from './controls';
import { leafPalettesEditor } from './leaf-palettes-editor';
import { SEASON_FIELDS, SEASON_TRACKS } from './fields';
import { trackEditor } from './track-editor';
import type { Panel } from './types';

export const seasonPanel: Panel = {
  id: 'season',
  title: 'Season Profile',
  render(context) {
    const root = document.createElement('div');
    const tracks = SEASON_TRACKS.map((track) => {
      const editor = trackEditor(context, {
        path: `season.${track.key}`,
        id: `track-${track.key}`,
        label: track.label,
        kind: track.kind === 'color' ? 'color' : 'number',
        min: 0,
        max: 1,
        absent: track.absent,
        resetText: track.absent ? 'Default' : undefined,
        tName: 'Season',
        addAt: (state) => state.season,
        addHint: 'Adds a keyframe at the preview Season',
      });
      if (track.fruit) {
        const show = (): void => {
          editor.hidden = context.store.state.definition.fruit === undefined;
        };
        context.store.subscribe(show);
        show();
      }
      return editor;
    });
    root.append(...SEASON_FIELDS.map((field) => fieldControl(context, field)), ...tracks, leafPalettesEditor(context));
    return root;
  },
};
