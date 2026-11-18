// The Species gallery (docs/species/README.md, images by `npm run gallery`) and the README's Species
// section: both must show every Species of the collection, so the owner can review each one's look.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as collection from '../../src/species';
import type { SpeciesDefinition } from '../../src/index';

const root = resolve(import.meta.dirname, '../..');
const galleryFile = resolve(root, 'docs/species/README.md');
const gallery = existsSync(galleryFile) ? readFileSync(galleryFile, 'utf8') : '';
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const { SPECIES_NAMES } = collection;
const STYLES = ['low-poly', 'stylized', 'realistic'];
const camelCase = (id: string) => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const speciesOf = (id: string) => (collection as unknown as Record<string, SpeciesDefinition>)[camelCase(id)]!;

/** The gallery section of one Species: from its heading to the next. */
function section(markdown: string, name: string): string {
  const start = markdown.indexOf(`\n## ${name}\n`);
  if (start < 0) return '';
  const next = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, next < 0 ? undefined : next);
}

/** Local link / image targets in a Markdown snippet (relative to the gallery page). */
const targets = (markdown: string) => [...markdown.matchAll(/\]\(([^)#\s]+)\)|src="([^"]+)"/g)].map((m) => m[1] ?? m[2]!);

describe('the Species gallery page', () => {
  it('lists all 28 Species', () => {
    expect(SPECIES_NAMES).toHaveLength(28);
    for (const id of SPECIES_NAMES) expect(section(gallery, speciesOf(id).name), id).not.toBe('');
  });

  for (const id of SPECIES_NAMES) {
    it(`${id}: an image per Style, a code example and a link to its JSON file`, () => {
      const species = speciesOf(id);
      const text = section(gallery, species.name);
      const files = targets(text).filter((t) => !t.startsWith('http'));
      for (const file of files) expect(existsSync(resolve(dirname(galleryFile), file)), `${id}: ${file} exists`).toBe(true);
      for (const style of STYLES) expect(files, `${id} summer in ${style}`).toContain(`images/${id}-${style}.jpg`);
      expect(files).toContain(`../../src/species/data/${id}.json`);
      expect(text).toContain(`import { ${camelCase(id)} } from '@casmo/tree.js/species';`);
      expect(text).toMatch(new RegExp(`createTree\\(\\w+\\.apply\\(${camelCase(id)}\\)`));
    });
  }

  it('shows the fruit trees with their Fruit and the deciduous broadleaves in autumn, in every Style', () => {
    const fruitTrees = ['almond', 'apple', 'cherry', 'olive', 'peach', 'pear', 'plum'];
    const autumn = ['ash', 'beech', 'birch', 'chestnut', 'elm', 'hickory', 'maple', 'oak', 'red-oak', 'walnut', 'white-oak'];
    for (const [ids, extra] of [[fruitTrees, 'fruit'], [autumn, 'autumn']] as const) {
      for (const id of ids) {
        const files = targets(section(gallery, speciesOf(id).name));
        for (const style of STYLES) expect(files, `${id} ${extra} in ${style}`).toContain(`images/${id}-${style}-${extra}.jpg`);
      }
    }
  });

  it('keeps every gallery image small (compressed, modest resolution)', () => {
    for (const file of targets(gallery).filter((t) => t.startsWith('images/'))) {
      expect(statSync(resolve(dirname(galleryFile), file)).size, file).toBeLessThan(60_000);
    }
  });
});

describe("the README's Species section", () => {
  const text = section(readme, 'Species');

  it('shows the contact sheet and links to the gallery', () => {
    expect(text).toContain('](docs/species/contact-sheet.jpg)');
    expect(existsSync(resolve(root, 'docs/species/contact-sheet.jpg'))).toBe(true);
    expect(statSync(resolve(root, 'docs/species/contact-sheet.jpg')).size).toBeLessThan(600_000);
    expect(text).toContain('](docs/species/README.md)');
  });

  it('lists all 28 Species', () => {
    for (const id of SPECIES_NAMES) expect(text, id).toContain(`\`${camelCase(id)}\``);
  });

  it('has a three-line usage example', () => {
    const code = /```ts\n([\s\S]*?)```/.exec(text)?.[1] ?? '';
    expect(code.trim().split('\n')).toHaveLength(3);
    expect(code).toContain("from '@casmo/tree.js/species'");
  });
});
