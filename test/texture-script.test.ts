import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/generate-textures.mjs', import.meta.url));
const committed = fileURLToPath(new URL('../assets/textures/realistic/', import.meta.url));

/** Runs the texture script into a fresh directory; returns file name -> bytes. */
function generate(): Map<string, Buffer> {
  const out = mkdtempSync(join(tmpdir(), 'tree-textures-'));
  execFileSync(process.execPath, [script, out], { stdio: 'pipe' });
  return new Map(readdirSync(out).sort().map((name) => [name, readFileSync(join(out, name))]));
}

describe('scripts/generate-textures.mjs', () => {
  it('is deterministic: two runs write identical files, the same as the committed ones', { timeout: 120_000 }, () => {
    const first = generate();
    const second = generate();
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [name, bytes] of first) expect(bytes.equals(second.get(name)!), name).toBe(true);
    expect([...first.keys()]).toEqual(readdirSync(committed).sort());
    for (const [name, bytes] of first) expect(bytes.equals(readFileSync(join(committed, name))), `${name} is up to date`).toBe(true);
  });
});
