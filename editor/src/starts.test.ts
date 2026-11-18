import { describe, expect, it } from 'vitest';
import { loadStyle, parseDefinition, type StyleName } from '@casmo/tree.js';
import { loadStart, STARTS } from './starts';

describe('starting points', () => {
  it('offers every built-in Style in both Forms', () => {
    expect(STARTS.map((start) => start.id)).toEqual(expect.arrayContaining(['low-poly/broadleaf', 'low-poly/conifer', 'stylized/broadleaf', 'stylized/conifer']));
  });

  it.each(STARTS.map((start) => [start.id, start] as const))('%s loads its Style\'s Definition for its Form', async (_id, start) => {
    const definition = await loadStart(start.id);
    expect(parseDefinition(definition)).toEqual(definition);
    const style = await loadStyle(start.style as StyleName);
    expect(definition).toEqual(style[start.form]);
  });

  it('rejects an unknown starting point', async () => {
    await expect(loadStart('nope/broadleaf')).rejects.toThrow(/nope\/broadleaf/);
  });
});
