// Fruit (ADR 0006): add or remove the Definition's `fruit` block and tune it. Its Season (amount
// and colour tracks) is in the Season Profile panel, shown while the tree has Fruit.
import { DEFAULT_FRUIT } from '@casmo/tree.js';
import { errorMessage, fieldControl, setDefinitionValue } from './controls';
import { FRUIT_FIELDS } from './fields';
import type { Panel } from './types';

export const fruitPanel: Panel = {
  id: 'fruit',
  title: 'Fruit',
  render(context) {
    const { store } = context;
    const root = document.createElement('div');
    const edit = (change: () => void): void => {
      try {
        change();
        context.report(null);
      } catch (error) {
        context.report(errorMessage(error));
      }
    };
    const button = (id: string, text: string, onClick: () => void): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.id = id;
      element.textContent = text;
      element.addEventListener('click', () => edit(onClick));
      return element;
    };

    let shown: boolean | null = null;
    const build = (): void => {
      const hasFruit = store.state.definition.fruit !== undefined;
      if (hasFruit === shown) return;
      shown = hasFruit;
      if (!hasFruit) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'No Fruit: the tree bears none.';
        root.replaceChildren(hint, button('add-fruit', 'Add Fruit', () => store.editDefinition({ fruit: { ...DEFAULT_FRUIT } })));
        return;
      }
      root.replaceChildren(
        ...FRUIT_FIELDS.map((field) => fieldControl(context, field)),
        button('remove-fruit', 'Remove Fruit', () => setDefinitionValue(store, 'fruit', undefined)),
      );
    };
    store.subscribe(build);
    build();
    return root;
  },
};
