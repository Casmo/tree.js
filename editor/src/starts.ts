// Starting points: every built-in Style in each Form, fetched with a dynamic import (each Style is
// its own chunk, as for any app using the library). Add a new Style to STYLES.
import type { TreeDefinition, TreeForm, TreeStyle } from '@casmo/tree.js';

const STYLES: Record<string, { label: string; load: () => Promise<{ default: TreeStyle }> }> = {
  'low-poly': { label: 'Low-poly', load: () => import('@casmo/tree.js/styles/low-poly') },
};

const FORMS: TreeForm[] = ['broadleaf', 'conifer'];

export interface Start {
  /** "<style>/<form>", e.g. "low-poly/conifer" (also the editor's `?start=` value). */
  id: string;
  label: string;
  style: string;
  form: TreeForm;
}

export const STARTS: readonly Start[] = Object.entries(STYLES).flatMap(([style, { label }]) =>
  FORMS.map((form) => ({ id: `${style}/${form}`, label: `${label} ${form}`, style, form })),
);

export const DEFAULT_START = STARTS[0]!.id;

/** The Definition of a starting point (a fresh copy, safe to edit). */
export async function loadStart(id: string): Promise<TreeDefinition> {
  const start = STARTS.find((candidate) => candidate.id === id);
  if (!start) throw new Error(`Unknown starting point "${id}"`);
  const style = (await STYLES[start.style]!.load()).default;
  return structuredClone(style[start.form]);
}
