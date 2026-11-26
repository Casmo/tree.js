import { describe, expect, it } from 'vitest';
import { loadStyle, parseDefinition, STYLE_NAMES } from '@casmo/tree.js';
import { oak, SPECIES_NAMES } from '@casmo/tree.js/species';
import { loadStart, parseStartId, SPECIES_GROUPS, startId, STARTS, STYLE_CHOICES } from './starts';

describe('starting points', () => {
  it('offers every Species of the collection, grouped by Form, plus the generic Forms', () => {
    const generic = SPECIES_GROUPS.find((group) => group.label === 'Generic');
    expect(generic?.species.map(({ id, label }) => [id, label])).toEqual([
      ['broadleaf', 'Generic broadleaf'],
      ['conifer', 'Generic conifer'],
    ]);
    const species = SPECIES_GROUPS.filter((group) => group !== generic).flatMap((group) => group.species.map(({ id }) => id));
    expect([...species].sort()).toEqual([...SPECIES_NAMES].sort());
    const broadleaves = SPECIES_GROUPS.find((group) => group.label === 'Broadleaf');
    expect(broadleaves?.species).toContainEqual({ id: 'oak', label: 'Oak' });
  });

  it('offers every built-in Style', () => {
    expect(STYLE_CHOICES.map((style) => style.id)).toEqual(STYLE_NAMES);
  });

  it('every Species × Style is a start, as "<species>/<style>"', () => {
    expect(STARTS).toHaveLength((SPECIES_NAMES.length + 2) * STYLE_NAMES.length);
    expect(STARTS.map((start) => start.id)).toEqual(expect.arrayContaining(['oak/realistic', 'broadleaf/low-poly', 'conifer/stylized']));
  });

  it('a Species start is the Style applied to the Species', async () => {
    const definition = await loadStart('oak/realistic');
    const realistic = await loadStyle('realistic');
    expect(definition).toEqual(realistic.apply(oak));
    expect(definition.species).toBe('oak');
    expect(parseDefinition(definition)).toEqual(definition);
  });

  it('a Painterly Species start is Painterly applied to the Species (at its Painterly size)', async () => {
    expect(parseStartId('oak/painterly')).toEqual({ id: 'oak/painterly', tree: { kind: 'species', id: 'oak' }, style: 'painterly' });
    const definition = await loadStart('oak/painterly');
    expect(definition).toEqual((await loadStyle('painterly')).apply(oak));
    expect(definition).toMatchObject({ species: 'oak', materials: { shading: 'painted' }, leaves: { shape: 'mass' } });
    expect(definition.trunk.length).toBeLessThan(oak.trunk.length * 0.5);
  });

  it.each(STYLE_NAMES.flatMap((style) => (['broadleaf', 'conifer'] as const).map((form) => [style, form] as const)))(
    'generic %s %s is that Style\'s own Definition, by the new and the old id',
    async (styleName, form) => {
      const style = await loadStyle(styleName);
      expect(await loadStart(`${form}/${styleName}`)).toEqual(style[form]);
      expect(await loadStart(`${styleName}/${form}`)).toEqual(style[form]);
    },
  );

  it('the Fantasy Styles are in the picker and every Species has a Whimsical and an Enchanted start', async () => {
    expect(STYLE_CHOICES).toEqual(expect.arrayContaining([{ id: 'whimsical', label: 'Whimsical' }, { id: 'enchanted', label: 'Enchanted' }]));
    expect(STARTS.map((start) => start.id)).toEqual(expect.arrayContaining(['oak/whimsical', 'pine/enchanted', 'conifer/whimsical']));
    expect(await loadStart('oak/whimsical')).toMatchObject({ species: 'oak', materials: { shading: 'whimsical' } });
    const pine = await loadStart('pine/enchanted');
    expect(pine).toMatchObject({ species: 'pine', materials: { shading: 'enchanted', innerGlow: { leaf: 1, veins: 1 } } });
    expect(pine.season.leafPalettes?.length).toBeGreaterThan(0);
  });

  it('reads new and old ids as Species + Style', () => {
    expect(parseStartId('oak/realistic')).toEqual({ id: 'oak/realistic', tree: { kind: 'species', id: 'oak' }, style: 'realistic' });
    expect(parseStartId('broadleaf/stylized')).toEqual({ id: 'broadleaf/stylized', tree: { kind: 'generic', form: 'broadleaf' }, style: 'stylized' });
    expect(parseStartId('low-poly/conifer')).toEqual({ id: 'conifer/low-poly', tree: { kind: 'generic', form: 'conifer' }, style: 'low-poly' });
    expect(parseStartId('my-tree.json')).toBeNull();
    expect(parseStartId('nope/realistic')).toBeNull();
    expect(parseStartId('oak/watercolour')).toBeNull();
  });

  it('names a start by its tree and Style', () => {
    expect(startId({ kind: 'species', id: 'white-oak' }, 'stylized')).toBe('white-oak/stylized');
    expect(startId({ kind: 'generic', form: 'conifer' }, 'realistic')).toBe('conifer/realistic');
  });

  it('rejects an unknown starting point', async () => {
    await expect(loadStart('nope/broadleaf')).rejects.toThrow(/nope\/broadleaf/);
    await expect(loadStart('oak/watercolour')).rejects.toThrow(/oak\/watercolour/);
  });
});
