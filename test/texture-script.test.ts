import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/generate-textures.mjs', import.meta.url));
const committed = fileURLToPath(new URL('../assets/textures/', import.meta.url));
const SETS = ['painterly', 'realistic'];

/** Runs the texture script into a fresh directory; returns 'set/file name' -> bytes. */
function generate(): Map<string, Buffer> {
  const out = mkdtempSync(join(tmpdir(), 'tree-textures-'));
  execFileSync(process.execPath, [script, out], { stdio: 'pipe' });
  expect(readdirSync(out).sort()).toEqual(SETS);
  return new Map(
    SETS.flatMap((set) => readdirSync(join(out, set)).sort().map((name) => [`${set}/${name}`, readFileSync(join(out, set, name))] as const)),
  );
}
const committedFiles = () => SETS.flatMap((set) => readdirSync(join(committed, set)).sort().map((name) => `${set}/${name}`));

describe('scripts/generate-textures.mjs', () => {
  it('is deterministic: two runs write identical files, the same as the committed ones', { timeout: 180_000 }, () => {
    const first = generate();
    const second = generate();
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [name, bytes] of first) expect(bytes.equals(second.get(name)!), name).toBe(true);
    expect([...first.keys()]).toEqual(committedFiles());
    for (const [name, bytes] of first) expect(bytes.equals(readFileSync(join(committed, name))), `${name} is up to date`).toBe(true);
  });

  it('makes a painterly spray card per Leaf Type, a painted bark per Bark Type and the Leaf Mass noise', () => {
    expect(readdirSync(join(committed, 'painterly')).sort()).toEqual([
      'bark-fibrous.png',
      'bark-furrowed.png',
      'bark-papery.png',
      'bark-plated.png',
      'bark-smooth.png',
      'mass-noise.png',
      'spray-broad.png',
      'spray-compound.png',
      'spray-lobed.png',
      'spray-needle.png',
      'spray-palmate.png',
      'spray-scale.png',
    ]);
  });
});
