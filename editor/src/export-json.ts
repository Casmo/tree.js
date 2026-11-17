// JSON export: the Tree Definition exactly as the library's parseDefinition/fetchDefinition reads it.
import type { TreeDefinition } from '@casmo/tree.js';

/** Pretty-printed JSON of a (complete, versioned) Tree Definition. */
export function definitionToJson(definition: TreeDefinition): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

/** A file name from the Definition's name, e.g. "Low-poly broadleaf" -> "low-poly-broadleaf.tree.json". */
export function definitionFileName(definition: TreeDefinition): string {
  const slug = definition.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'tree'}.tree.json`;
}
