// Starting points: a Species (or a generic Form) in a Style, with the id "<species>/<style>" (also
// the editor's `?start=` value, e.g. "oak/realistic"). The generic Forms are each Style's own
// broadleaf/conifer Definitions; old "<style>/<form>" ids (e.g. "low-poly/conifer") still work.
// Species come from the collection (SPECIES_NAMES), so a new Species shows up without a change
// here; each Style is fetched with `loadStyle` (its own chunk, as for any app using the library).
import { loadStyle, STYLE_NAMES, styleLabel, type StyleName, type TreeDefinition, type TreeForm } from '@casmo/tree.js';
import { SPECIES_BY_NAME, SPECIES_NAMES, type SpeciesName } from '@casmo/tree.js/species';

const FORMS: TreeForm[] = ['broadleaf', 'conifer'];

export interface Choice {
  id: string;
  label: string;
}

/** The Species picker: the generic Forms first, then the collection grouped by Form. */
export const SPECIES_GROUPS: readonly { label: string; species: readonly Choice[] }[] = [
  { label: 'Generic', species: FORMS.map((form) => ({ id: form, label: `Generic ${form}` })) },
  ...FORMS.map((form) => ({
    label: form[0]!.toUpperCase() + form.slice(1),
    species: SPECIES_NAMES.map((id) => SPECIES_BY_NAME[id]).filter((species) => species.form === form).map(({ id, name }) => ({ id, label: name })),
  })).filter((group) => group.species.length > 0),
];

/** The Style picker: every built-in Style. */
export const STYLE_CHOICES: readonly Choice[] = STYLE_NAMES.map((id) => ({ id, label: styleLabel(id) }));

/** What a start grows: a Species of the collection, or a Style's generic Definition of a Form. */
export type StartTree = { kind: 'species'; id: SpeciesName } | { kind: 'generic'; form: TreeForm };

export interface Start {
  /** "<species>/<style>", e.g. "oak/realistic" or "conifer/low-poly". */
  id: string;
  tree: StartTree;
  style: StyleName;
}

/** The picker value of a start's tree: the Species id or the Form. */
export const treeChoice = (tree: StartTree): string => (tree.kind === 'species' ? tree.id : tree.form);

/** The id of a start: "<species or form>/<style>". */
export const startId = (tree: StartTree, style: StyleName): string => `${treeChoice(tree)}/${style}`;

const isStyle = (name: string): name is StyleName => (STYLE_NAMES as string[]).includes(name);
const isForm = (name: string): name is TreeForm => (FORMS as string[]).includes(name);
const isSpecies = (name: string): name is SpeciesName => Object.hasOwn(SPECIES_BY_NAME, name);

/** The tree of a picker value (a Species id or a Form), null for anything else. */
function startTree(choice: string): StartTree | null {
  if (isForm(choice)) return { kind: 'generic', form: choice };
  if (isSpecies(choice)) return { kind: 'species', id: choice };
  return null;
}

export const STARTS: readonly Start[] = SPECIES_GROUPS.flatMap((group) =>
  group.species.flatMap(({ id }) => STYLE_NAMES.map((style) => ({ id: `${id}/${style}`, tree: startTree(id)!, style }))),
);

export const DEFAULT_START = 'broadleaf/low-poly';

/**
 * The tree and Style of a start id, new ("oak/realistic") or old ("low-poly/conifer"); `id` is
 * the new form. Null for anything else (e.g. an imported file name).
 */
export function parseStartId(id: string): Start | null {
  const [first = '', second = '', ...rest] = id.split('/');
  if (rest.length > 0) return null;
  const tree = startTree(first);
  if (tree && isStyle(second)) return { id, tree, style: second };
  if (isStyle(first) && isForm(second)) return { id: `${second}/${first}`, tree: { kind: 'generic', form: second }, style: first };
  return null;
}

/** The Definition of a starting point (a fresh copy, safe to edit). */
export async function loadStart(id: string): Promise<TreeDefinition> {
  const start = parseStartId(id);
  if (!start) throw new Error(`Unknown starting point "${id}"`);
  const style = await loadStyle(start.style);
  return start.tree.kind === 'species' ? style.apply(SPECIES_BY_NAME[start.tree.id]) : structuredClone(style[start.tree.form]);
}
