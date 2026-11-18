// @casmo/tree.js/species: the Species collection (ADR 0005). One named camelCase export per Species
// (tree-shakeable: each Species is its own module), `loadSpecies(id)` for picking one at runtime, and
// `SPECIES_NAMES`. Every Species is also shipped as plain JSON: `@casmo/tree.js/species/<id>.json`.
//   import { oak } from '@casmo/tree.js/species';
//   createTree(lowPoly.apply(oak), { seed: 42 });
// The data lives in src/species/data/<id>.json; catalog.ts and loaders.ts are generated from it
// (`npm run species`).
import { SPECIES_LOADERS, type SpeciesName } from './loaders';
import type { SpeciesDefinition } from './types';

export * from './catalog';
export type { SpeciesName };
export type * from './types';

/** Ids of all Species in the collection (kebab-case), sorted. */
export const SPECIES_NAMES = Object.keys(SPECIES_LOADERS) as SpeciesName[];

/** Downloads a Species (dynamic import) and resolves to it. Rejects for an unknown id. */
export async function loadSpecies(id: SpeciesName): Promise<SpeciesDefinition> {
  const load = Object.hasOwn(SPECIES_LOADERS, id) ? SPECIES_LOADERS[id] : undefined;
  if (!load) throw new Error(`Unknown tree.js Species "${id}". Species: ${SPECIES_NAMES.join(', ')}.`);
  return (await load()).default as SpeciesDefinition;
}
