// Addressing one parameter of a Tree Definition by a dotted path: "trunk.length", "branches.1.count",
// "season.leafColor.0.value". Parameter panels bind their controls with these paths.
import { parseDefinition, type TreeDefinition } from '@casmo/tree.js';

/** The value at `path`, or undefined when the path does not exist. */
export function getAt(definition: TreeDefinition, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], definition);
}

/** A new, validated Definition with the value at `path` replaced (throws TreeDefinitionError when invalid). */
export function setAt(definition: TreeDefinition, path: string, value: unknown): TreeDefinition {
  const replace = (node: unknown, [key, ...rest]: string[]): unknown => {
    const child = rest.length === 0 ? value : replace((node as Record<string, unknown>)[key!], rest);
    if (Array.isArray(node)) return node.map((item, i) => (String(i) === key ? child : item));
    return { ...(node as Record<string, unknown>), [key!]: child };
  };
  return parseDefinition(replace(definition, path.split('.')));
}
