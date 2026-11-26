// A panel for an optional Definition block (Fruit, Roots): "Add" writes the block with its defaults,
// then the block's fields and a "Remove" button are shown; "Remove" deletes the block again.
// Also the shared pieces for any optional-block control (the Ground Tint toggle uses them too).
import type { TreeDefinition } from '@casmo/tree.js';
import { errorMessage, fieldControl, setDefinitionValue } from './controls';
import type { Field } from './fields';
import type { Panel, PanelContext } from './types';

/** The optional top-level Definition blocks that get their own Add/Remove panel. */
export type OptionalBlockKey = 'fruit' | 'roots';

/** Runs an edit and reports its error in the status line (or clears the status line on success). */
export function reportEdit(context: PanelContext, change: () => void): void {
  try {
    change();
    context.report(null);
  } catch (error) {
    context.report(errorMessage(error));
  }
}

/**
 * Follows whether an optional block is present (or any other value, e.g. how many entries a list has):
 * `sync` runs now and on every store change; `rebuild` runs only when the value changes (and once at the start).
 */
export function followPresence<T = boolean>(
  context: PanelContext,
  isPresent: () => T,
  rebuild: (present: T) => void,
  sync: (present: T) => void = () => {},
): void {
  let shown: { value: T } | null = null;
  const update = (): void => {
    const present = isPresent();
    sync(present);
    if (shown && present === shown.value) return;
    shown = { value: present };
    rebuild(present);
  };
  context.store.subscribe(update);
  update();
}

interface BlockPanelOptions<K extends OptionalBlockKey> {
  /** The block's key in the Definition; also the panel id and the button ids (`add-<key>`, `remove-<key>`). */
  key: K;
  title: string;
  fields: Field[];
  defaults: NonNullable<TreeDefinition[K]>;
  /** Shown while the Definition has no such block. */
  hint: string;
}

export function blockPanel<K extends OptionalBlockKey>({ key, title, fields, defaults, hint }: BlockPanelOptions<K>): Panel {
  return {
    id: key,
    title,
    render(context) {
      const { store } = context;
      const root = document.createElement('div');
      const button = (id: string, text: string, onClick: () => void): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button';
        element.id = id;
        element.textContent = text;
        element.addEventListener('click', () => reportEdit(context, onClick));
        return element;
      };

      followPresence(
        context,
        () => store.state.definition[key] !== undefined,
        (present) => {
          if (!present) {
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
        },
      );
      return root;
    },
  };
}
