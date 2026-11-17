import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, DEFAULT_DEFINITION, extendDefinition, parseDefinition } from '@casmo/tree.js';
import { definitionFileName, definitionToJson } from './export-json';

describe('JSON export', () => {
  it('writes a versioned Tree Definition the library loads back unchanged', () => {
    const definition = extendDefinition(DEFAULT_DEFINITION, { name: 'Oak', trunk: { length: 6.25 } });
    const json = definitionToJson(definition);
    expect(JSON.parse(json).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(parseDefinition(json)).toEqual(definition);
    expect(json.endsWith('\n')).toBe(true);
  });

  it('names the file after the Definition', () => {
    expect(definitionFileName({ ...DEFAULT_DEFINITION, name: 'Low-poly broadleaf' })).toBe('low-poly-broadleaf.tree.json');
    expect(definitionFileName({ ...DEFAULT_DEFINITION, name: '  Oak / Tall!  ' })).toBe('oak-tall.tree.json');
    expect(definitionFileName({ ...DEFAULT_DEFINITION, name: '' })).toBe('tree.tree.json');
  });
});
