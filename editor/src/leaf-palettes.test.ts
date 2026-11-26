import { describe, expect, it } from 'vitest';
import { DEFAULT_DEFINITION, extendDefinition, type LeafPalette } from '@casmo/tree.js';
import { createHistory } from './history';
import { addLeafPalette, removeLeafPalette } from './leaf-palettes';
import { setDefinitionValue } from './panels/controls';
import { createEditorStore } from './store';

const teal: LeafPalette = { leafColor: [{ t: 0, value: '#2fb8a0' }, { t: 0.7, value: '#c040a0' }], accent: '#ffd040' };
const violet: LeafPalette = { leafColor: [{ t: 0, value: '#7040c0' }], accent: '#40e0ff' };

const setup = (palettes?: LeafPalette[]) => {
  const definition = extendDefinition(DEFAULT_DEFINITION, { season: palettes ? { leafPalettes: palettes } : {} });
  const store = createEditorStore({ definition, seed: 1 });
  const history = createHistory(store, { now: () => 0 });
  return { store, history };
};

describe('Leaf Palette editing', () => {
  it('the first palette takes the Leaf colour track, so the tree looks the same; the accent starts at its first colour', () => {
    const { store } = setup();
    const leafColor = store.state.definition.season.leafColor;
    addLeafPalette(store);
    expect(store.state.definition.season.leafPalettes).toEqual([{ leafColor, accent: leafColor[0]!.value }]);
    expect(store.state.definition.season.leafColor).toEqual(leafColor);
  });

  it('a further palette starts as a copy of the last one', () => {
    const { store } = setup([teal, violet]);
    addLeafPalette(store);
    expect(store.state.definition.season.leafPalettes).toEqual([teal, violet, violet]);
  });

  it('removes a palette; removing the last one drops the field and leaves its colours on the Leaf colour track', () => {
    const { store } = setup([teal, violet]);
    removeLeafPalette(store, 0);
    expect(store.state.definition.season.leafPalettes).toEqual([violet]);
    removeLeafPalette(store, 0);
    expect(store.state.definition.season).not.toHaveProperty('leafPalettes');
    expect(store.state.definition.season.leafColor).toEqual(violet.leafColor);
  });

  it('every add, remove and keyframe or accent edit is one undoable step', () => {
    const { store, history } = setup([teal]);
    const initial = store.state.definition;
    addLeafPalette(store);
    setDefinitionValue(store, 'season.leafPalettes.1.accent', '#ff0000');
    setDefinitionValue(store, 'season.leafPalettes.1.leafColor.1.value', '#00ff00');
    const edited = store.state.definition;
    expect(edited.season.leafPalettes![1]).toEqual({ leafColor: [teal.leafColor[0], { t: 0.7, value: '#00ff00' }], accent: '#ff0000' });
    removeLeafPalette(store, 0);

    history.undo();
    expect(store.state.definition).toEqual(edited);
    history.undo();
    history.undo();
    history.undo();
    expect(store.state.definition).toEqual(initial);
    expect(history.canUndo).toBe(false);
  });
});
