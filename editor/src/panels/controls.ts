// Small DOM controls bound to the editor store: they write through the store and re-read on every
// change (so undo, imports and other panels keep them in sync). Parameter panels build on these.
import { TreeDefinitionError } from '@casmo/tree.js';
import { getAt, setAt } from '../definition-path';
import type { EditorState, EditorStore } from '../store';
import type { PanelContext } from './types';

export interface NumberControlOptions {
  label: string;
  /** DOM id (also used by tests), e.g. "trunk.length". */
  id: string;
  min: number;
  max: number;
  step: number;
  /** 'range' updates live while dragging; 'number' on commit. */
  kind?: 'range' | 'number';
  get(state: EditorState): number;
  set(store: EditorStore, value: number): void;
}

export function numberControl(context: PanelContext, options: NumberControlOptions): HTMLElement {
  const { store } = context;
  const row = document.createElement('div');
  row.className = 'control';
  const label = document.createElement('label');
  label.htmlFor = options.id;
  label.textContent = options.label;
  const input = document.createElement('input');
  input.type = options.kind ?? 'range';
  input.id = options.id;
  Object.assign(input, { min: String(options.min), max: String(options.max), step: String(options.step) });
  const output = document.createElement('output');
  output.htmlFor.add(options.id);
  row.append(label, input, output);

  const sync = (state: EditorState): void => {
    const value = options.get(state);
    if (document.activeElement !== input || input.type === 'range') input.value = String(value);
    output.textContent = formatNumber(value, options.step);
    input.removeAttribute('aria-invalid');
  };
  const commit = (): void => {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    try {
      options.set(store, value);
      context.report(null);
      sync(store.state);
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      context.report(errorMessage(error));
    }
  };
  input.addEventListener(input.type === 'range' ? 'input' : 'change', commit);
  store.subscribe((state) => sync(state));
  sync(store.state);
  return row;
}

/** A number control for one Definition parameter, addressed by a dotted path ("trunk.length", "branches.0.count"). */
export function definitionNumber(
  context: PanelContext,
  path: string,
  options: Omit<NumberControlOptions, 'id' | 'get' | 'set'>,
): HTMLElement {
  return numberControl(context, {
    kind: 'number',
    ...options,
    id: path,
    get: (state) => getAt(state.definition, path) as number,
    set: (store, value) => store.set({ definition: setAt(store.state.definition, path, value) }),
  });
}

export function textControl(
  context: PanelContext,
  options: { label: string; id: string; get(state: EditorState): string; set(store: EditorStore, value: string): void },
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'control';
  const label = document.createElement('label');
  label.htmlFor = options.id;
  label.textContent = options.label;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = options.id;
  row.append(label, input);
  const sync = (state: EditorState): void => {
    if (document.activeElement !== input) input.value = options.get(state);
  };
  input.addEventListener('change', () => {
    try {
      options.set(context.store, input.value);
      context.report(null);
    } catch (error) {
      context.report(errorMessage(error));
    }
  });
  context.store.subscribe(sync);
  sync(context.store.state);
  return row;
}

export function errorMessage(error: unknown): string {
  if (error instanceof TreeDefinitionError) return error.message.replace(/^Invalid Tree Definition: /, '');
  return error instanceof Error ? error.message : String(error);
}

function formatNumber(value: number, step: number): string {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toFixed(decimals);
}
