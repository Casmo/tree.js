import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { createTree, generateTree, hashTreeData, parseDefinition, resolveTextureUrl } from '../../src/index';

const realistic = await import('../../src/styles/realistic');
const forms = { broadleaf: realistic.broadleaf, conifer: realistic.conifer };

describe('realistic Style (dynamic import of the /styles/realistic subpath)', () => {
  it('exports a broadleaf and a conifer Definition, also as one Style object', () => {
    expect(realistic.broadleaf.form).toBe('broadleaf');
    expect(realistic.conifer.form).toBe('conifer');
    expect(realistic.default).toEqual({ name: 'realistic', broadleaf: realistic.broadleaf, conifer: realistic.conifer });
  });

  for (const [form, definition] of Object.entries(forms)) {
    it(`${form}: is a complete, valid Definition (parsing changes nothing)`, () => {
      expect(parseDefinition(definition)).toEqual(definition);
    });

    it(`${form}: uses smooth shading, textured bark and alpha-cut leaf cards shipped with the package`, () => {
      const { bark, leaf, shading } = definition.materials;
      expect(shading).toBe('standard');
      expect(definition.leaves.shape).toBe('card');
      for (const url of [bark.map, bark.normalMap, leaf.map]) {
        expect(url).toMatch(/^realistic\/.+\.png$/);
        expect(existsSync(fileURLToPath(resolveTextureUrl(url!))), url!).toBe(true);
      }
    });

    it(`${form}: grows a tree whose materials carry its textures`, () => {
      const tree = createTree(definition, { seed: 1 });
      expect(tree.data.skeleton.branches.length).toBeGreaterThan(10);
      expect(tree.data.skeleton.leaves.length).toBeGreaterThan(50);
      const wood = tree.wood.material as MeshStandardNodeMaterial;
      expect(wood.map?.name).toBe(resolveTextureUrl(definition.materials.bark.map!));
      expect(wood.normalMap?.name).toBe(resolveTextureUrl(definition.materials.bark.normalMap!));
      expect(tree.leaves.material.map?.name).toBe(resolveTextureUrl(definition.materials.leaf.map!));
      expect(tree.leaves.material.alphaTest).toBe(definition.materials.leaf.alphaTest);
      tree.dispose();
    });

    it(`${form}: matches the golden geometry hash (determinism across releases)`, () => {
      expect(hashTreeData(generateTree(parseDefinition(definition), 42))).toMatchSnapshot();
    });
  }

  it('the broadleaf is deciduous, the conifer evergreen', () => {
    expect(Math.min(...realistic.broadleaf.season.leafCoverage.map((k) => k.value))).toBe(0);
    expect(realistic.conifer.season.leafCoverage.every((k) => k.value === 1)).toBe(true);
  });

  it('is published as its own subpath, with its textures in the package, not pulled in by the core entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./styles/realistic']).toEqual({
      types: './dist/styles/realistic/index.d.ts',
      import: './dist/styles/realistic.js',
    });
    expect(pkg.files).toContain('dist');
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/styles\/realistic/);
  });
});
