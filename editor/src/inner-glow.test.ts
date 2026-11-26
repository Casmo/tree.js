import { describe, expect, it } from 'vitest';
import { DEFAULT_INNER_GLOW, extendDefinition } from '@casmo/tree.js';
import { createHistory } from './history';
import { hasInnerGlowControls, liveInnerGlowChange, setInnerGlow } from './inner-glow';
import { setDefinitionValue } from './panels/controls';
import { loadStart } from './starts';
import { createEditorStore } from './store';

async function editor(id: string) {
  const store = createEditorStore({ definition: await loadStart(id), source: id, seed: 1 });
  let time = 0;
  const history = createHistory(store, { now: () => (time += 10_000) });
  return { store, history };
}

describe('Inner Glow in the editor', () => {
  it('has controls only with the enchanted shading (the only one that draws it)', async () => {
    const { store } = await editor('oak/enchanted');
    expect(hasInnerGlowControls(store.state.definition)).toBe(true);
    for (const shading of ['standard', 'flat', 'toon', 'painted', 'whimsical', 'stylized-painted'] as const) {
      expect(hasInnerGlowControls(extendDefinition(store.state.definition, { materials: { shading } }))).toBe(false);
    }
  });

  it('an Enchanted start glows; switched off it removes the field, on it writes the default strengths', async () => {
    const { store, history } = await editor('oak/enchanted');
    const own = store.state.definition.materials.innerGlow;
    expect(own).toEqual(DEFAULT_INNER_GLOW);
    setInnerGlow(store, false);
    expect(store.state.definition.materials).not.toHaveProperty('innerGlow');
    setInnerGlow(store, false); // no empty step
    setInnerGlow(store, true);
    expect(store.state.definition.materials.innerGlow).toEqual(DEFAULT_INNER_GLOW);
    history.undo();
    history.undo();
    expect(store.state.definition.materials.innerGlow).toEqual(own);
    expect(history.canUndo).toBe(false);
  });

  it('a slider edit retunes the tree on show without a new tree; anything else needs a new tree', async () => {
    const { store } = await editor('oak/enchanted');
    const before = store.state.definition;
    setDefinitionValue(store, 'materials.innerGlow.leaf', 2.5);
    const leaf = store.state.definition;
    setDefinitionValue(store, 'materials.innerGlow.veins', 0.2);
    const veins = store.state.definition;
    expect(liveInnerGlowChange(before, leaf)).toEqual({ leaf: 2.5, veins: 1 });
    expect(liveInnerGlowChange(before, veins)).toEqual({ leaf: 2.5, veins: 0.2 }); // both at once (undo/redo)
    expect(liveInnerGlowChange(leaf, leaf)).toBeNull(); // nothing changed

    setInnerGlow(store, false);
    const off = store.state.definition;
    expect(liveInnerGlowChange(veins, off)).toBeNull(); // switched off
    expect(liveInnerGlowChange(off, veins)).toBeNull(); // switched on
    const longer = extendDefinition(veins, { trunk: { length: 3 }, materials: { innerGlow: { leaf: 1 } } });
    expect(liveInnerGlowChange(veins, longer)).toBeNull(); // another parameter changed too
    // Another shading keeps the field but draws no glow: nothing to retune.
    const toon = extendDefinition(veins, { materials: { shading: 'toon' } });
    expect(liveInnerGlowChange(toon, extendDefinition(toon, { materials: { innerGlow: { leaf: 3 } } }))).toBeNull();
  });
});
