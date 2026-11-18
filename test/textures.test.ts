import { afterEach, describe, expect, it } from 'vitest';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  createTree,
  DEFAULT_DEFINITION,
  DEFAULT_TEXTURE_BASE_PATH,
  extendDefinition,
  resolveTextureUrl,
  setTextureOptions,
} from '../src/index';

const textured = extendDefinition(DEFAULT_DEFINITION, {
  materials: { bark: { map: 'realistic/bark.png', normalMap: 'realistic/bark-normal.png' }, leaf: { map: 'realistic/leaf.png' } },
});
const barkMap = (tree: ReturnType<typeof createTree>) => (tree.wood.material as MeshStandardNodeMaterial).map?.name;

afterEach(() => setTextureOptions({}));

describe('texture URLs', () => {
  it('resolves relative URLs against the package textures by default', () => {
    expect(DEFAULT_TEXTURE_BASE_PATH).toMatch(/\/textures\/$/);
    expect(resolveTextureUrl('realistic/bark.png')).toBe(`${DEFAULT_TEXTURE_BASE_PATH}realistic/bark.png`);
  });

  it('keeps absolute URLs as they are', () => {
    for (const url of ['https://example.com/bark.jpg', '/textures/bark.jpg', 'data:image/png;base64,AAAA', 'blob:x']) {
      expect(resolveTextureUrl(url, { basePath: 'https://cdn.example.com/' })).toBe(url);
    }
  });

  it('a base path override moves every relative texture to the app CDN', () => {
    expect(resolveTextureUrl('realistic/bark.png', { basePath: 'https://cdn.example.com/trees' })).toBe(
      'https://cdn.example.com/trees/realistic/bark.png',
    );
    expect(resolveTextureUrl('realistic/bark.png', { basePath: 'assets/' })).toBe('assets/realistic/bark.png');
  });

  it('a per-URL override replaces one texture', () => {
    const urls = { 'realistic/leaf.png': 'https://cdn.example.com/my-leaf.webp' };
    expect(resolveTextureUrl('realistic/leaf.png', { urls })).toBe('https://cdn.example.com/my-leaf.webp');
    expect(resolveTextureUrl('realistic/bark.png', { urls, basePath: '/t/' })).toBe('/t/realistic/bark.png');
  });

  it('the app-wide base path applies to trees created afterwards; a tree option wins over it', () => {
    setTextureOptions({ basePath: 'https://cdn.example.com/global/' });
    expect(barkMap(createTree(textured))).toBe('https://cdn.example.com/global/realistic/bark.png');
    const own = createTree(textured, { textures: { basePath: 'https://cdn.example.com/own/' } });
    expect(barkMap(own)).toBe('https://cdn.example.com/own/realistic/bark.png');
    expect(own.leaves.material.map?.name).toBe('https://cdn.example.com/own/realistic/leaf.png');
  });
});

describe('custom textures in a Definition', () => {
  it('a Definition can use its own bark and leaf textures', () => {
    const custom = extendDefinition(DEFAULT_DEFINITION, {
      materials: { bark: { map: 'https://example.com/oak-bark.jpg' }, leaf: { map: 'https://example.com/oak-leaf.png', alphaTest: 0.3 } },
    });
    const tree = createTree(custom);
    expect(barkMap(tree)).toBe('https://example.com/oak-bark.jpg');
    expect((tree.wood.material as MeshStandardNodeMaterial).normalMap).toBeNull();
    expect(tree.leaves.material.map?.name).toBe('https://example.com/oak-leaf.png');
    expect(tree.leaves.material.alphaTest).toBe(0.3);
  });

  it('trees share one texture per URL', () => {
    const a = createTree(textured);
    const b = createTree(textured, { seed: 2 });
    expect((a.wood.material as MeshStandardNodeMaterial).map).toBe((b.wood.material as MeshStandardNodeMaterial).map);
  });

  it('a tree without textures has no maps and is ready at once', async () => {
    const tree = createTree(DEFAULT_DEFINITION);
    expect((tree.wood.material as MeshStandardNodeMaterial).map).toBeNull();
    expect(tree.leaves.material.map).toBeNull();
    await expect(tree.ready).resolves.toBeUndefined();
  });
});
