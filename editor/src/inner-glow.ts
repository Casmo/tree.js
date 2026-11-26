// Inner Glow (`materials.innerGlow`) in the editor: switching it on (the default strengths) or off
// (removing the field), and telling the preview when a slider edit can retune the tree on show
// (`tree.innerGlow`) instead of generating it again. Only the enchanted shading draws it.
import { DEFAULT_INNER_GLOW, type InnerGlowDefinition, type TreeDefinition } from '@casmo/tree.js';
import { setAt } from './definition-path';
import type { EditorStore } from './store';

/** Whether the Inner Glow controls show: only the enchanted shading draws the glow. */
export function hasInnerGlowControls(definition: TreeDefinition): boolean {
  return definition.materials.shading === 'enchanted';
}

/** Switches Inner Glow on (the default strengths) or off (no field), as one history step; nothing when unchanged. */
export function setInnerGlow(store: EditorStore, on: boolean): void {
  const { definition } = store.state;
  if (on === (definition.materials.innerGlow !== undefined)) return;
  store.set({ definition: setAt(definition, 'materials.innerGlow', on ? { ...DEFAULT_INNER_GLOW } : undefined) });
}

/**
 * When `next` differs from `previous` only in its Inner Glow strengths, both glowing with the
 * enchanted shading, the tree on show can take them live: returns the new strengths. Null otherwise
 * (anything else changed, the glow was switched on or off, another shading, or nothing changed).
 */
export function liveInnerGlowChange(previous: TreeDefinition, next: TreeDefinition): InnerGlowDefinition | null {
  const before = previous.materials.innerGlow;
  const after = next.materials.innerGlow;
  if (!before || !after || !hasInnerGlowControls(previous) || !hasInnerGlowControls(next)) return null;
  if (before.leaf === after.leaf && before.veins === after.veins) return null;
  // Both with the strengths blanked out in place (so the key order stays): equal = nothing else changed.
  const blank = (definition: TreeDefinition): string =>
    JSON.stringify({ ...definition, materials: { ...definition.materials, innerGlow: { leaf: 0, veins: 0 } } });
  return blank(previous) === blank(next) ? { ...after } : null;
}
