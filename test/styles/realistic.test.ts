import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { BARK_TYPES, createTree, extendDefinition, hashTreeData, LEAF_TYPES, parseDefinition, resolveTextureUrl, type SpeciesDefinition } from '../../src/index';
import { generateTree } from '../../src/generator';

const realistic = await import('../../src/styles/realistic');
const forms = { broadleaf: realistic.broadleaf, conifer: realistic.conifer };

describe('realistic Style (dynamic import of the /styles/realistic subpath)', () => {
  it('exports a broadleaf and a conifer Definition, also as one Style object', () => {
    expect(realistic.broadleaf.name).toMatch(/broadleaf/);
    expect(realistic.conifer.name).toMatch(/conifer/);
    expect(realistic.default).toMatchObject({ name: 'realistic', broadleaf: realistic.broadleaf, conifer: realistic.conifer });
    expect(realistic.default.apply).toBeTypeOf('function');
  });

  for (const [form, definition] of Object.entries(forms)) {
    it(`${form}: is a complete, valid Definition (parsing changes nothing)`, () => {
      expect(parseDefinition(definition)).toEqual(definition);
    });

    it(`${form}: puts 3 extra rings in a Root Flare, like the Style draws a Species`, () => {
      expect(definition.trunk.flareSections).toBe(3);
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

  describe('a texture for every Leaf Type and Bark Type', () => {
    const species = (leaf: SpeciesDefinition['foliage']['type'], bark: SpeciesDefinition['bark']['type']) =>
      realistic.default.apply(extendDefinition(realistic.broadleaf, { leaves: { type: leaf }, materials: { bark: { type: bark } } }));

    it('ships the file for each one', () => {
      const urls = [...Object.values(realistic.LEAF_TEXTURES), ...Object.values(realistic.BARK_TEXTURES).flatMap((b) => [b.map, b.normalMap])];
      expect(Object.keys(realistic.LEAF_TEXTURES).sort()).toEqual([...LEAF_TYPES].sort());
      expect(Object.keys(realistic.BARK_TEXTURES).sort()).toEqual([...BARK_TYPES].sort());
      for (const url of urls) expect(existsSync(fileURLToPath(resolveTextureUrl(url))), url).toBe(true);
    });

    it('loads them from an app-provided base path (asset path override)', () => {
      const definition = species('palmate', 'fibrous');
      const tree = createTree(definition, { seed: 1, textures: { basePath: 'https://cdn.example.com/trees/' } });
      const wood = tree.wood.material as MeshStandardNodeMaterial;
      expect(wood.map?.name).toBe('https://cdn.example.com/trees/realistic/bark-fibrous.png');
      expect(wood.normalMap?.name).toBe('https://cdn.example.com/trees/realistic/bark-fibrous-normal.png');
      expect(tree.leaves.material.map?.name).toBe('https://cdn.example.com/trees/realistic/leaf-palmate.png');
      tree.dispose();
    });
  });
});
