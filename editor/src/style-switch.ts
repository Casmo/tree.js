// Style switch: re-applies a Style to the Definition being edited (`Style.apply`, ADR 0005), so only
// the look changes (shading, detail, textures, how leaves/bark/Fruit are drawn) and shape edits stay.
// One store change, so it is one undoable history step.
import type { StyleName, TreeDefinition } from '@casmo/tree.js';
import { loadEditorStyle, parseStartId } from './starts';
import type { EditorState, EditorStore } from './store';

const STYLE_OF_SHADING: Record<TreeDefinition['materials']['shading'], StyleName> = {
  flat: 'low-poly',
  toon: 'stylized',
  standard: 'realistic',
};

/** The Style the editor is in: the start's Style, else (imported JSON) the one its shading belongs to. */
export function currentStyle(state: Pick<EditorState, 'definition' | 'source'>): StyleName {
  return parseStartId(state.source)?.style ?? STYLE_OF_SHADING[state.definition.materials.shading];
}

/** Switches the Definition being edited to another Style, keeping its shape. */
export async function switchStyle(store: EditorStore, style: StyleName): Promise<void> {
  if (currentStyle(store.state) === style) return;
  const { definition, source } = store.state;
  const restyled = (await loadEditorStyle(style)).apply(definition);
  if (store.state.definition !== definition || store.state.source !== source) return; // edited meanwhile
  const start = parseStartId(source);
  store.set({ definition: restyled, source: start ? `${start.species}/${style}` : source });
}
