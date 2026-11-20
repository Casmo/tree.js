import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  createTree,
  extendDefinition,
  hashTreeData,
  loadStyle,
  parseDefinition,
  resolveTextureUrl,
  STYLE_NAMES,
  styleLabel,
  styleOfShading,
  type TreeDefinition,
} from '../../src/index';
import { generateTree } from '../../src/generator';

describe('painterly Style registration', () => {
  it('is a built-in Style, labelled "Painterly", drawn with the painted shading', () => {
    expect(STYLE_NAMES).toContain('painterly');
    expect(styleLabel('painterly')).toBe('Painterly');
    expect(styleOfShading('painted')).toBe('painterly');
  });

  it('the painted shading round-trips through the schema', async () => {
    const { broadleaf } = await loadStyle('stylized');
    const painted = parseDefinition({ ...broadleaf, materials: { ...broadleaf.materials, shading: 'painted' } });
    expect(painted.materials.shading).toBe('painted');
  });

  it('is published as its own subpath, not pulled in by the core entry', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./styles/painterly']).toEqual({
      types: './dist/styles/painterly/index.d.ts',
      import: './dist/styles/painterly.js',
    });
    expect(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/styles\/painterly/);
    expect((await loadStyle('painterly')).name).toBe('painterly');
  });
});

describe('painterly Style (dynamic import of the /styles/painterly subpath)', async () => {
  const painterly = await import('../../src/styles/painterly');
  const { broadleaf } = painterly;

  it('exports a broadleaf Definition, also on the Style object', () => {
    expect(broadleaf.name).toMatch(/broadleaf/);
    expect(painterly.default).toMatchObject({ name: 'painterly', broadleaf });
    expect(painterly.default.apply).toBeTypeOf('function');
  });

  it('broadleaf: is a complete, valid Definition (parsing changes nothing)', () => {
    expect(parseDefinition(broadleaf)).toEqual(broadleaf);
  });

  it('broadleaf: is 3 m tall at full Growth (ADR 0013)', () => {
    const { wood, leaves } = generateTree(parseDefinition(broadleaf), 42);
    let top = 0;
    for (const positions of [wood.positions, leaves.positions]) for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]!);
    expect(top).toBeGreaterThan(2.85);
    expect(top).toBeLessThan(3.15);
  });

  it('broadleaf: draws Leaf Masses of painted spray cards and painted bark, shipped with the package', () => {
    const { bark, leaf, shading } = broadleaf.materials;
    expect(shading).toBe('painted');
    expect(broadleaf.leaves.shape).toBe('mass');
    expect(bark.normalMap).toBeNull();
    for (const url of [bark.map, leaf.map]) {
      expect(url).toMatch(/^painterly\/.+\.png$/);
      expect(existsSync(fileURLToPath(resolveTextureUrl(url!))), url!).toBe(true);
    }
  });

  it('broadleaf: grows a tree lit by the painted model, with its textures', () => {
    const tree = createTree(broadleaf, { seed: 1 });
    for (const material of [tree.wood.material, tree.leaves.material, tree.fruit.material]) {
      expect(material).toMatchObject({ isPaintedMaterial: true, flatShading: false });
    }
    expect(tree.leaves.material.map?.name).toBe(resolveTextureUrl(broadleaf.materials.leaf.map!));
    expect((tree.wood.material as MeshStandardNodeMaterial).map?.name).toBe(resolveTextureUrl(broadleaf.materials.bark.map!));
    tree.dispose();
  });

  it('broadleaf: costs about what a stylized broadleaf costs (triangles, draw calls)', async () => {
    const stylized = (await loadStyle('stylized')).broadleaf;
    const triangles = (definition: TreeDefinition) => {
      const data = generateTree(parseDefinition(definition), 42);
      return (data.wood.indices.length + data.leaves.indices.length + data.fruit.indices.length) / 3;
    };
    expect(triangles(broadleaf)).toBeLessThan(triangles(stylized) * 1.25);
  });

  it('broadleaf: matches the golden Definition and geometry hash (determinism across releases)', () => {
    expect(broadleaf).toMatchSnapshot();
    expect(hashTreeData(generateTree(parseDefinition(broadleaf), 42))).toMatchSnapshot();
  });

  describe('conifer (#113, ADR 0014: clumped spray cards, no Tier)', () => {
    const { conifer } = painterly;
    const top = (definition: TreeDefinition) => {
      const { wood, leaves } = generateTree(parseDefinition(definition), 42);
      let y = 0;
      for (const positions of [wood.positions, leaves.positions]) for (let i = 1; i < positions.length; i += 3) y = Math.max(y, positions[i]!);
      return y;
    };

    it('is a complete, valid Definition, also on the Style object', () => {
      expect(conifer.name).toMatch(/conifer/);
      expect(painterly.default).toMatchObject({ conifer });
      expect(parseDefinition(conifer)).toEqual(conifer);
    });

    it('is 3.5 m tall at full Growth (ADR 0013)', () => {
      expect(top(conifer)).toBeGreaterThan(3.35);
      expect(top(conifer)).toBeLessThan(3.65);
    });

    it('draws flat, layered Leaf Masses of painted needle sprays, evergreen', () => {
      expect(conifer.materials.shading).toBe('painted');
      expect(conifer.leaves).toMatchObject({ type: 'needle', shape: 'mass' });
      expect(conifer.leaves.massLayering).toBeGreaterThan(1);
      expect(conifer.materials.leaf.map).toBe('painterly/spray-needle.png');
      expect(conifer.season.leafCoverage.every((k) => k.value === 1)).toBe(true);
    });

    it('costs about what a stylized conifer costs (triangles)', async () => {
      const stylized = (await loadStyle('stylized')).conifer;
      const triangles = (definition: TreeDefinition) => {
        const data = generateTree(parseDefinition(definition), 42);
        return (data.wood.indices.length + data.leaves.indices.length + data.fruit.indices.length) / 3;
      };
      expect(triangles(conifer)).toBeLessThan(triangles(stylized) * 1.25);
    });

    it('matches the golden Definition and geometry hash (determinism across releases)', () => {
      expect(conifer).toMatchSnapshot();
      expect(hashTreeData(generateTree(parseDefinition(conifer), 42))).toMatchSnapshot();
    });
  });

  it('apply draws a Species with Leaf Masses and painted textures per Leaf Type and Bark Type', () => {
    const definition = painterly.default.apply(extendDefinition(broadleaf, { leaves: { type: 'lobed' }, materials: { bark: { type: 'papery' } } }));
    expect(definition.materials.shading).toBe('painted');
    expect(definition.leaves.shape).toBe('mass');
    expect(definition.materials.leaf.map).toBe('painterly/spray-lobed.png');
    expect(definition.materials.bark.map).toBe('painterly/bark-papery.png');
  });
});
