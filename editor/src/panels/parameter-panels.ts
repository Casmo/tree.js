// Parameter panels generated from the field table: Tree (name), Trunk, Leaves, Materials,
// Seed variation. Branching levels, the Season Profile and Wind have their own panels.
import { DEFAULT_GROUND_TINT } from '@casmo/tree.js';
import { getAt } from '../definition-path';
import { applyMaterialFeatures, hasMaterialFeatures, setMaterialFeature, suggestedMaterialFeatures } from '../material-features';
import { followPresence, reportEdit } from './block-panel';
import { fieldControl, setDefinitionValue } from './controls';
import { GROUND_TINT_FIELDS, MATERIAL_FEATURES, PARAMETER_GROUPS, type FieldGroup } from './fields';
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
 * it is on, its colour, height and strength) right after the bark controls, and the Material
 * features group at the end.
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
      materialFeatureControls(context),
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
  input.addEventListener('change', () =>
    reportEdit(context, () => setDefinitionValue(store, GROUND_TINT, input.checked ? { ...DEFAULT_GROUND_TINT } : undefined)),
  );
  followPresence(
    context,
    () => store.state.definition.materials.bark.groundTint !== undefined,
    (present) => fields.replaceChildren(...(present ? GROUND_TINT_FIELDS.map((field) => fieldControl(context, field)) : [])),
    (present) => {
      input.checked = present;
    },
  );
  return root;
}

/**
 * "Material features" (ADR 0008): a checkbox per feature (on writes the Style's suggested value,
 * off removes the field) with its sliders while on, "Use suggested for <Style>" and "Off".
 */
function materialFeatureControls(context: PanelContext): HTMLElement {
  const { store } = context;
  const root = document.createElement('div');
  root.className = 'material-features';
  const heading = document.createElement('h3');
  heading.textContent = 'Material features';
  root.append(heading);

  for (const feature of MATERIAL_FEATURES) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `material-feature-${feature.key}`;
    const label = document.createElement('label');
    label.className = 'toggle';
    label.append(input, ` ${feature.label}`);
    const fields = document.createElement('div');
    root.append(label, fields);
    input.addEventListener('change', () => reportEdit(context, () => setMaterialFeature(store, feature.key, input.checked)));
    followPresence(
      context,
      () => getAt(store.state.definition, feature.path) !== undefined,
      (present) => fields.replaceChildren(...(present ? feature.fields.map((field) => fieldControl(context, field)) : [])),
      (present) => {
        input.checked = present;
      },
    );
  }

  const button = (id: string, onClick: () => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.id = id;
    element.addEventListener('click', () => reportEdit(context, onClick));
    return element;
  };
  const suggested = button('material-features-suggested', () => applyMaterialFeatures(store, suggestedMaterialFeatures(store.state).features));
  const off = button('material-features-off', () => applyMaterialFeatures(store, {}));
  off.textContent = 'Off';
  const sync = (): void => {
    suggested.textContent = `Use suggested for ${suggestedMaterialFeatures(store.state).style}`;
    off.disabled = !hasMaterialFeatures(store.state.definition);
  };
  store.subscribe(sync);
  sync();
  root.append(suggested, off);
  return root;
}

export const variationPanel = fieldGroupPanel(group('variation'));
export { group as parameterGroup };
