// Parameter panels generated from the field table: Tree (name), Trunk, Leaves, Materials,
// Seed variation. Branching levels, the Season Profile and Wind have their own panels.
import { fieldControl } from './controls';
import { PARAMETER_GROUPS, type FieldGroup } from './fields';
import type { Panel } from './types';

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
export const materialsPanel = fieldGroupPanel(group('materials'));
export const variationPanel = fieldGroupPanel(group('variation'));
export { group as parameterGroup };
