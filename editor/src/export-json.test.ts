import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, DEFAULT_DEFINITION, extendDefinition, parseDefinition } from '@casmo/tree.js';
import { definitionFileName, definitionToJson } from './export-json';
import { loadStart } from './starts';

describe('JSON export', () => {
  it('writes a versioned Tree Definition the library loads back unchanged', () => {
    const definition = extendDefinition(DEFAULT_DEFINITION, { name: 'Oak', trunk: { length: 6.25 } });
    const json = definitionToJson(definition);
    expect(JSON.parse(json).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(parseDefinition(json)).toEqual(definition);
    expect(json.endsWith('\n')).toBe(true);
  });

  it('writes a fantasy tree (Twist, Leaf Palettes, Inner Glow) the library loads back unchanged', async () => {
    for (const id of ['oak/whimsical', 'pine/enchanted']) {
      const definition = extendDefinition(await loadStart(id), {
        season: { leafPalettes: [{ leafColor: [{ t: 0, value: '#22aa88' }, { t: 0.8, value: '#cc3399' }], accent: '#ffee55' }] },
        ...(id.endsWith('enchanted') ? { materials: { innerGlow: { leaf: 3.1, veins: 0 } } } : {}),
      });
      expect(parseDefinition(definitionToJson(definition))).toEqual(definition);
    }
  });

  it('keeps each level\'s Tip Branches, 0 included, and leaves an absent one absent', () => {
    const [first, second] = DEFAULT_DEFINITION.branches;
    const definition = { ...DEFAULT_DEFINITION, branches: [{ ...first!, tipBranches: 3 }, { ...second!, tipBranches: 0 }, { ...second! }] };
    const written = JSON.parse(definitionToJson(definition)) as { branches: { tipBranches?: number }[] };
    expect(written.branches.map((level) => level.tipBranches)).toEqual([3, 0, undefined]);
    expect('tipBranches' in written.branches[2]!).toBe(false);
    expect(parseDefinition(definitionToJson(definition))).toEqual(definition);
  });

  it('names the file after the Definition', () => {
    expect(definitionFileName({ ...DEFAULT_DEFINITION, name: 'Low-poly broadleaf' })).toBe('low-poly-broadleaf.tree.json');
    expect(definitionFileName({ ...DEFAULT_DEFINITION, name: '  Oak / Tall!  ' })).toBe('oak-tall.tree.json');
    expect(definitionFileName({ ...DEFAULT_DEFINITION, name: '' })).toBe('tree.tree.json');
  });
});
