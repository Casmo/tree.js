// Parameter panels generated from the field table: Tree (name), Trunk, Leaves, Materials,
// Seed variation. Branching levels, the Season Profile and Wind have their own panels.
import { DEFAULT_GROUND_TINT } from '@casmo/tree.js';
import { errorMessage, fieldControl, setDefinitionValue } from './controls';
import { GROUND_TINT_FIELDS, PARAMETER_GROUPS, type FieldGroup } from './fields';
import type { Panel, PanelContext } from './types';

export function fieldGroupPanel(group: FieldGroup): Panel {
  return {
    id: group.id,
    title: group.title,
    render(context) {
      const root = document.createElement('div');
      root.append(...group.fields.map((field) => fieldControl(context, field)));
      return root;
    },
  };
}

function group(id: string): FieldGroup {
  const found = PARAMETER_GROUPS.find((g) => g.id === id);
  if (!found) throw new Error(`No parameter group "${id}"`);
  return found;
}

export const treePanel = fieldGroupPanel(group('tree'));
export const trunkPanel = fieldGroupPanel(group('trunk'));
export const leavesPanel = fieldGroupPanel(group('leaves'));
/**
 * The Materials panel: the field table's Materials fields, with the Ground Tint toggle (and, while
 * it is on, its colour, height and strength) right after the bark controls.
 */
export const materialsPanel: Panel = {
  id: 'materials',
  title: 'Materials',
  render(context) {
    const root = document.createElement('div');
    const fields = group('materials').fields;
    const afterBark = fields.findIndex((field) => field.path.startsWith('materials.leaf.'));
    root.append(
      ...fields.slice(0, afterBark).map((field) => fieldControl(context, field)),
      groundTintControls(context),
      ...fields.slice(afterBark).map((field) => fieldControl(context, field)),
    );
    return root;
  },
};

const GROUND_TINT = 'materials.bark.groundTint';

/** "Ground Tint" checkbox: on writes the block with its defaults, off removes it; its fields show while on. */
function groundTintControls(context: PanelContext): HTMLElement {
  const { store } = context;
  const root = document.createElement('div');
  root.className = 'ground-tint';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = GROUND_TINT;
  const label = document.createElement('label');
  label.className = 'toggle';
  label.append(input, ' Ground Tint');
  const fields = document.createElement('div');
  root.append(label, fields);
  input.addEventListener('change', () => {
    try {
      setDefinitionValue(store, GROUND_TINT, input.checked ? { ...DEFAULT_GROUND_TINT } : undefined);
      context.report(null);
    } catch (error) {
      context.report(errorMessage(error));
    }
  });

  let shown: boolean | null = null;
  const sync = (): void => {
    const has = store.state.definition.materials.bark.groundTint !== undefined;
    input.checked = has;
    if (has === shown) return;
    shown = has;
    fields.replaceChildren(...(has ? GROUND_TINT_FIELDS.map((field) => fieldControl(context, field)) : []));
  };
  store.subscribe(sync);
  sync();
  return root;
}
export const variationPanel = fieldGroupPanel(group('variation'));
export { group as parameterGroup };
