// A panel for an optional Definition block (Fruit, Roots): "Add" writes the block with its defaults,
// then the block's fields and a "Remove" button are shown; "Remove" deletes the block again.
import type { TreeDefinition } from '@casmo/tree.js';
import { errorMessage, fieldControl, setDefinitionValue } from './controls';
import type { Field } from './fields';
import type { Panel } from './types';

interface BlockPanelOptions<K extends 'fruit' | 'roots'> {
  /** The block's key in the Definition; also the panel id and the button ids (`add-<key>`, `remove-<key>`). */
  key: K;
  title: string;
  fields: Field[];
  defaults: NonNullable<TreeDefinition[K]>;
  /** Shown while the Definition has no such block. */
  hint: string;
}

export function blockPanel<K extends 'fruit' | 'roots'>({ key, title, fields, defaults, hint }: BlockPanelOptions<K>): Panel {
  return {
    id: key,
    title,
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
        const has = store.state.definition[key] !== undefined;
        if (has === shown) return;
        shown = has;
        if (!has) {
          const text = document.createElement('p');
          text.className = 'hint';
          text.textContent = hint;
          root.replaceChildren(text, button(`add-${key}`, `Add ${title}`, () => store.editDefinition({ [key]: { ...defaults } })));
          return;
        }
        root.replaceChildren(
          ...fields.map((field) => fieldControl(context, field)),
          button(`remove-${key}`, `Remove ${title}`, () => setDefinitionValue(store, key, undefined)),
        );
      };
      store.subscribe(build);
      build();
      return root;
    },
  };
}
