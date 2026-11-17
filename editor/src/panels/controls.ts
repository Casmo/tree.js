// Small DOM controls bound to the editor store: they write through the store and re-read on every
// change (so undo, imports and other panels keep them in sync). Parameter panels build on these.
// A rejected value (TreeDefinitionError) marks the input aria-invalid and shows the message under
// the control (and in the status line) until the value is fixed or changed elsewhere.
import { TreeDefinitionError } from '@casmo/tree.js';
import { getAt, setAt } from '../definition-path';
import type { EditorState, EditorStore } from '../store';
import type { Field } from './fields';
import type { PanelContext } from './types';

export interface NumberControlOptions {
  label: string;
  /** DOM id (also used by tests), e.g. "trunk.length". */
  id: string;
  min: number;
  max: number;
  step: number;
  /**
   * 'range' updates live while dragging; 'number' on commit; 'slider' = both: a slider (live)
   * next to a number field (exact values, also beyond the slider's range).
   */
  kind?: 'range' | 'number' | 'slider';
  get(state: EditorState): number;
  set(store: EditorStore, value: number): void;
}

/** One labelled row: `.control` grid plus an error line that spans it. */
interface Row {
  row: HTMLElement;
  /** Shows (string) or clears (null) the error for this control. */
  showError(message: string | null): void;
  readonly invalid: boolean;
}

function controlRow(context: PanelContext, id: string, labelText: string, input: HTMLElement, ...rest: HTMLElement[]): Row {
  const row = document.createElement('div');
  row.className = 'control';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  input.id = id;
  const error = document.createElement('small');
  error.className = 'field-error';
  error.id = `${id}-error`;
  error.hidden = true;
  input.setAttribute('aria-describedby', error.id);
  row.append(label, ...rest, error);
  if (!rest.includes(input)) row.insertBefore(input, label.nextSibling);
  let invalid = false;
  return {
    row,
    get invalid() {
      return invalid;
    },
    showError(message) {
      invalid = message !== null;
      error.textContent = message ?? '';
      error.hidden = !invalid;
      row.classList.toggle('invalid', invalid);
      for (const element of row.querySelectorAll('input, select')) {
        if (invalid) element.setAttribute('aria-invalid', 'true');
        else element.removeAttribute('aria-invalid');
      }
      if (invalid) context.report(message);
    },
  };
}

/**
 * Follows the store: `sync` runs on every change in which `read` changed (or always without a
 * previous value). Stops listening once `element` has left the document (rebuilt lists).
 */
function follow<T>(context: PanelContext, element: HTMLElement, read: (state: EditorState) => T, sync: (value: T) => void): void {
  const unsubscribe = context.store.subscribe((state, previous) => {
    if (!element.isConnected) return unsubscribe();
    if (read(state) !== read(previous)) sync(read(state));
  });
  sync(read(context.store.state));
}

/** Runs an edit; on failure shows the error at the control and keeps the input as typed. */
function attempt(context: PanelContext, row: Row, edit: () => void): void {
  try {
    edit();
    row.showError(null);
    context.report(null);
  } catch (error) {
    row.showError(errorMessage(error));
  }
}

/** Calls `fn` at most once per animation frame, with the latest arguments (live slider edits). */
function perFrame<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let pending: A | null = null;
  return (...args) => {
    if (pending === null) requestAnimationFrame(() => {
      const latest = pending!;
      pending = null;
      fn(...latest);
    });
    pending = args;
  };
}

export function numberControl(context: PanelContext, options: NumberControlOptions): HTMLElement {
  const { store } = context;
  const kind = options.kind ?? 'range';
  const input = document.createElement('input');
  input.type = kind === 'range' ? 'range' : 'number';
  Object.assign(input, { min: String(options.min), max: String(options.max), step: String(options.step) });
  const extra: HTMLElement[] = [];
  let slider: HTMLInputElement | null = null;
  let output: HTMLOutputElement | null = null;
  if (kind === 'slider') {
    // A mouse affordance for the number field (which carries the label and is what assistive tech uses).
    slider = document.createElement('input');
    slider.type = 'range';
    Object.assign(slider, { min: String(options.min), max: String(options.max), step: String(options.step), tabIndex: -1 });
    slider.setAttribute('aria-hidden', 'true');
    extra.push(slider, input);
  } else if (kind === 'range') {
    output = document.createElement('output');
    output.htmlFor.add(options.id);
    extra.push(input, output);
  } else {
    extra.push(input);
  }
  const row = controlRow(context, options.id, options.label, input, ...extra);
  if (kind === 'slider') row.row.classList.add('slider');

  const show = (value: number): void => {
    if (document.activeElement !== input || input.type === 'range') input.value = String(value);
    if (slider) slider.value = String(value);
    if (output) output.textContent = formatNumber(value, options.step);
  };
  const commit = (value: number): void =>
    attempt(context, row, () => {
      if (!Number.isFinite(value)) throw new Error(`${options.label}: enter a number`);
      options.set(store, value);
      show(options.get(store.state));
    });
  input.addEventListener(input.type === 'range' ? 'input' : 'change', () => commit(input.valueAsNumber));
  if (slider) {
    const live = perFrame(commit);
    slider.addEventListener('input', () => {
      input.value = slider!.value;
      live(slider!.valueAsNumber);
    });
  }
  follow(context, row.row, options.get, (value) => {
    show(value);
    row.showError(null);
  });
  return row.row;
}

/** A number control for one Definition parameter, addressed by a dotted path ("trunk.length", "branches.0.count"). */
export function definitionNumber(
  context: PanelContext,
  path: string,
  options: Omit<NumberControlOptions, 'id' | 'get' | 'set'>,
): HTMLElement {
  return numberControl(context, {
    kind: 'slider',
    ...options,
    id: path,
    get: (state) => getAt(state.definition, path) as number,
    set: (store, value) => setDefinitionValue(store, path, value),
  });
}

/** Replaces the parameter at `path` (throws TreeDefinitionError when the result is invalid). */
export function setDefinitionValue(store: EditorStore, path: string, value: unknown): void {
  store.set({ definition: setAt(store.state.definition, path, value) });
}

export function textControl(
  context: PanelContext,
  options: { label: string; id: string; placeholder?: string; get(state: EditorState): string; set(store: EditorStore, value: string): void },
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  if (options.placeholder) input.placeholder = options.placeholder;
  const row = controlRow(context, options.id, options.label, input);
  row.row.classList.add('wide');
  input.addEventListener('change', () => attempt(context, row, () => options.set(context.store, input.value)));
  follow(context, row.row, options.get, (value) => {
    input.value = value;
    row.showError(null);
  });
  return row.row;
}

/** A drop-down for one Definition parameter. */
export function definitionChoice(context: PanelContext, path: string, label: string, choices: readonly string[]): HTMLElement {
  const select = document.createElement('select');
  for (const choice of choices) select.add(new Option(choice, choice));
  const row = controlRow(context, path, label, select);
  row.row.classList.add('wide');
  select.addEventListener('change', () => attempt(context, row, () => setDefinitionValue(context.store, path, select.value)));
  follow(context, row.row, (state) => getAt(state.definition, path) as string, (value) => {
    select.value = value;
    row.showError(null);
  });
  return row.row;
}

/** A colour picker (`#rrggbb`) for one Definition parameter; the preview follows while picking. */
export function colorControl(
  context: PanelContext,
  options: { id: string; label: string; get(state: EditorState): string; set(store: EditorStore, value: string): void },
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'color';
  const code = document.createElement('output');
  code.htmlFor.add(options.id);
  const row = controlRow(context, options.id, options.label, input, input, code);
  row.row.classList.add('color');
  const live = perFrame((value: string) => attempt(context, row, () => options.set(context.store, value)));
  input.addEventListener('input', () => live(input.value));
  follow(context, row.row, options.get, (value) => {
    input.value = value.toLowerCase();
    code.textContent = value.toLowerCase();
    row.showError(null);
  });
  return row.row;
}

/** A texture URL (relative to the texture base path, or absolute); empty = no texture (null). */
export function definitionUrl(context: PanelContext, path: string, label: string): HTMLElement {
  return textControl(context, {
    id: path,
    label,
    placeholder: 'none',
    get: (state) => (getAt(state.definition, path) as string | null) ?? '',
    set: (store, value) => setDefinitionValue(store, path, value.trim() === '' ? null : value.trim()),
  });
}

/** The control for one entry of the field table (`fields.ts`); `path` overrides the field's own path. */
export function fieldControl(context: PanelContext, field: Field, path = field.path): HTMLElement {
  switch (field.kind) {
    case 'number':
      return definitionNumber(context, path, { label: field.label, min: field.min, max: field.max, step: field.step });
    case 'choice':
      return definitionChoice(context, path, field.label, field.options);
    case 'color':
      return colorControl(context, {
        id: path,
        label: field.label,
        get: (state) => getAt(state.definition, path) as string,
        set: (store, value) => setDefinitionValue(store, path, value),
      });
    case 'url':
      return definitionUrl(context, path, field.label);
    case 'text':
      return textControl(context, {
        id: path,
        label: field.label,
        get: (state) => getAt(state.definition, path) as string,
        set: (store, value) => setDefinitionValue(store, path, value),
      });
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof TreeDefinitionError) return error.message.replace(/^Invalid Tree Definition: /, '');
  return error instanceof Error ? error.message : String(error);
}

function formatNumber(value: number, step: number): string {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toFixed(decimals);
}
