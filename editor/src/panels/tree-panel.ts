// A few headline parameters of the Definition. The full parameter panels (ticket #16) sit next to it.
import { definitionNumber, textControl } from './controls';
import type { Panel } from './types';

export const treePanel: Panel = {
  id: 'tree',
  title: 'Tree',
  render(context) {
    const root = document.createElement('div');
    root.append(
      textControl(context, {
        label: 'Name',
        id: 'name',
        get: (state) => state.definition.name,
        set: (store, name) => store.editDefinition({ name }),
      }),
      definitionNumber(context, 'trunk.length', { label: 'Trunk length', min: 0.1, max: 30, step: 0.1 }),
      definitionNumber(context, 'trunk.radius', { label: 'Trunk radius', min: 0.01, max: 3, step: 0.01 }),
      definitionNumber(context, 'leaves.count', { label: 'Leaves per twig', min: 0, max: 64, step: 1 }),
      definitionNumber(context, 'leaves.size', { label: 'Leaf size', min: 0.01, max: 5, step: 0.01 }),
    );
    return root;
  },
};
