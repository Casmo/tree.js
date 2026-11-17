import { describe, expect, it } from 'vitest';
import { parseDefinition } from '@casmo/tree.js';
import { loadStart, STARTS } from './starts';

describe('starting points', () => {
  it('offers every built-in Style in both Forms', () => {
    expect(STARTS.map((start) => start.id)).toEqual(expect.arrayContaining(['low-poly/broadleaf', 'low-poly/conifer']));
  });

  it.each(STARTS.map((start) => [start.id, start] as const))('%s loads a valid Definition of its Form', async (_id, start) => {
    const definition = await loadStart(start.id);
    expect(parseDefinition(definition)).toEqual(definition);
    expect(definition.form).toBe(start.form);
  });

  it('rejects an unknown starting point', async () => {
    await expect(loadStart('nope/broadleaf')).rejects.toThrow(/nope\/broadleaf/);
  });
});
