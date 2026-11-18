// Starting points: a Species (or a generic Form) in a Style, with the id "<species>/<style>" (also
// the editor's `?start=` value, e.g. "oak/realistic"). The generic Forms are each Style's own
// broadleaf/conifer Definitions; old "<style>/<form>" ids (e.g. "low-poly/conifer") still work.
// Species come from the collection (SPECIES_NAMES), so a new Species shows up without a change
// here; each Style is fetched with a dynamic import (its own chunk, as for any app using the library).
import { STYLE_NAMES, type StyleName, type TreeDefinition, type TreeForm, type TreeStyle } from '@casmo/tree.js';
import * as collection from '@casmo/tree.js/species';
import { SPECIES_NAMES, type SpeciesDefinition } from '@casmo/tree.js/species';

const STYLE_LOADERS: Record<StyleName, { label: string; load: () => Promise<{ default: TreeStyle }> }> = {
  'low-poly': { label: 'Low-poly', load: () => import('@casmo/tree.js/styles/low-poly') },
  stylized: { label: 'Stylized', load: () => import('@casmo/tree.js/styles/stylized') },
  realistic: { label: 'Realistic', load: () => import('@casmo/tree.js/styles/realistic') },
};

const FORMS: TreeForm[] = ['broadleaf', 'conifer'];

const isSpecies = (value: unknown): value is SpeciesDefinition =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' && 'form' in value;

/** Every Species of the collection by id, in SPECIES_NAMES order. */
const SPECIES = new Map<string, SpeciesDefinition>(
  SPECIES_NAMES.flatMap((id) => {
    const species = Object.values(collection).find((value) => isSpecies(value) && value.id === id);
    return isSpecies(species) ? [[id, species] as const] : [];
  }),
);

export interface Choice {
  id: string;
  label: string;
}

/** The Species picker: the generic Forms first, then the collection grouped by Form. */
export const SPECIES_GROUPS: readonly { label: string; species: readonly Choice[] }[] = [
  { label: 'Generic', species: FORMS.map((form) => ({ id: form, label: `Generic ${form}` })) },
  ...FORMS.map((form) => ({
    label: form[0]!.toUpperCase() + form.slice(1),
    species: [...SPECIES.values()].filter((species) => species.form === form).map(({ id, name }) => ({ id, label: name })),
  })).filter((group) => group.species.length > 0),
];

/** The Style picker: every built-in Style. */
export const STYLE_CHOICES: readonly Choice[] = STYLE_NAMES.map((id) => ({ id, label: STYLE_LOADERS[id].label }));

export interface Start {
  /** "<species>/<style>", e.g. "oak/realistic" or "conifer/low-poly". */
  id: string;
  /** A Species id, or a Form ("broadleaf" / "conifer") for the Style's generic Definition. */
  species: string;
  style: StyleName;
}

export const STARTS: readonly Start[] = SPECIES_GROUPS.flatMap((group) =>
  group.species.flatMap(({ id: species }) => STYLE_NAMES.map((style) => ({ id: `${species}/${style}`, species, style }))),
);

export const DEFAULT_START = 'broadleaf/low-poly';

const isStyle = (name: string): name is StyleName => (STYLE_NAMES as string[]).includes(name);
const isSpeciesChoice = (name: string): boolean => (FORMS as string[]).includes(name) || SPECIES.has(name);

/**
 * The Species and Style of a start id, new ("oak/realistic") or old ("low-poly/conifer"); `id` is
 * the new form. Null for anything else (e.g. an imported file name).
 */
export function parseStartId(id: string): Start | null {
  const [first = '', second = '', ...rest] = id.split('/');
  if (rest.length > 0) return null;
  if (isSpeciesChoice(first) && isStyle(second)) return { id, species: first, style: second };
  if (isStyle(first) && (FORMS as string[]).includes(second)) return { id: `${second}/${first}`, species: second, style: first };
  return null;
}

/** Loads a built-in Style (dynamic import). */
export async function loadEditorStyle(style: StyleName): Promise<TreeStyle> {
  return (await STYLE_LOADERS[style].load()).default;
}

/** The Definition of a starting point (a fresh copy, safe to edit). */
export async function loadStart(id: string): Promise<TreeDefinition> {
  const start = parseStartId(id);
  if (!start) throw new Error(`Unknown starting point "${id}"`);
  const style = await loadEditorStyle(start.style);
  const species = SPECIES.get(start.species);
  return species ? style.apply(species) : structuredClone(style[start.species as TreeForm]);
}
