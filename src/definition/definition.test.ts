import { describe, expect, it } from 'vitest';
import { parseDefinition, TreeDefinitionError } from './index';

const minimal = { schemaVersion: 1 };

describe('parseDefinition', () => {
  it('fills defaults for a minimal Definition', () => {
    const def = parseDefinition(minimal);
    expect(def.schemaVersion).toBe(1);
    expect(def.trunk.length).toBeGreaterThan(0);
    expect(def.trunk.radius).toBeGreaterThan(0);
    expect(def.bark.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('keeps given values over defaults', () => {
    const def = parseDefinition({ schemaVersion: 1, trunk: { length: 7 } });
    expect(def.trunk.length).toBe(7);
  });

  it('rejects input without a schemaVersion, naming the field', () => {
    expect(() => parseDefinition({})).toThrow(TreeDefinitionError);
    expect(() => parseDefinition({})).toThrow(/schemaVersion/);
  });

  it('rejects a bad trunk value, naming the field path', () => {
    try {
      parseDefinition({ schemaVersion: 1, trunk: { radius: -1 } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TreeDefinitionError);
      expect((e as TreeDefinitionError).field).toBe('trunk.radius');
    }
  });

  it('rejects a non-object input', () => {
    expect(() => parseDefinition(null)).toThrow(TreeDefinitionError);
  });
});
