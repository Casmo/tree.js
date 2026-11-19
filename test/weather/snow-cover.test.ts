// Snow Cover (#100, ADR 0012, GLOSSARY): a ready-made Tree Shader Hook in `@casmo/tree.js/weather` that
// whitens upward-facing surfaces by a scene-wide snow amount, shared like `sceneWind`. Opt-in: nothing
// changes unless it is imported and set (ADR 0008). Pixels are checked in e2e/snow-cover.spec.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vec3 } from 'three/tsl';
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';
import { createTree, setSceneShaderHooks, stackShaderHooks, type Tree, type TreeShaderHook } from '../../src/index';
import { pear } from '../../src/species';
import stylized from '../../src/styles/stylized';
import { sceneSnow, Snow, SnowCover } from '../../src/weather';

afterEach(() => setSceneShaderHooks({}));

const PARTS = ['bark', 'leaves', 'fruit'] as const;
const materialsOf = (tree: Tree) => ({ bark: tree.wood.material as MeshStandardNodeMaterial, leaves: tree.leaves.material, fruit: tree.fruit.material });

/** Whether a node graph reads `target`. */
function reads(root: Node, target: Node): boolean {
  const seen = new Set<Node>();
  const visit = (node: Node): boolean => {
    if (node === target) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    return node.getChildren().some((child) => visit(child as Node));
  };
  return visit(root);
}

describe('the scene-wide snow amount', () => {
  it('is one shared object, 0 (no snow) unless set', () => {
    expect(sceneSnow).toBeInstanceOf(Snow);
    expect(sceneSnow.amount).toBe(0);
    expect(new Snow().amount).toBe(0);
  });

  it('is set live as a uniform (0..1), and rejects other values', () => {
    const snow = new Snow({ amount: 0.4 });
    const uniform = snow.uniforms.amount;
    expect(uniform.value).toBe(0.4);
    snow.amount = 1;
    expect(snow.set({ amount: 0.25 })).toBe(snow);
    expect(snow.amount).toBe(0.25);
    expect(snow.uniforms.amount).toBe(uniform);
    expect(uniform.value).toBe(0.25);
    for (const bad of [-0.1, 1.5, Number.NaN]) expect(() => (snow.amount = bad)).toThrow(RangeError);
  });
});

describe('Snow Cover', () => {
  it('is a set of Tree Shader Hooks for bark, leaves and fruit that follows the scene-wide snow amount', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    const plain = Object.fromEntries(PARTS.map((part) => [part, materialsOf(tree)[part].colorNode]));
    const snow = new SnowCover();
    expect(snow.snow).toBe(sceneSnow);
    tree.shaderHooks = snow;
    for (const part of PARTS) {
      const colorNode = materialsOf(tree)[part].colorNode as Node;
      expect(colorNode, part).not.toBe(plain[part]);
      expect(reads(colorNode, sceneSnow.uniforms.amount), part).toBe(true);
    }
    tree.shaderHooks = {};
    for (const part of PARTS) expect(materialsOf(tree)[part].colorNode).toBe(plain[part]);
    tree.dispose();
  });

  it('follows another snow amount when given one', () => {
    const tree = createTree(stylized.apply(pear), { seed: 2 });
    const own = new Snow({ amount: 1 });
    tree.shaderHooks = new SnowCover({ snow: own });
    expect(reads(tree.leaves.material.colorNode as Node, own.uniforms.amount)).toBe(true);
    expect(reads(tree.leaves.material.colorNode as Node, sceneSnow.uniforms.amount)).toBe(false);
    tree.dispose();
  });

  it("is ready-made: it runs before the app's own hooks, in whatever order they are stacked or set", () => {
    const snow = new SnowCover();
    const app = vi.fn<TreeShaderHook>(({ color }) => color.mul(vec3(1, 0, 1)));
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: stackShaderHooks({ leaves: app }, snow) });
    expect(reads(app.mock.calls[0]![0].color, sceneSnow.uniforms.amount)).toBe(true); // the app sees the snowed colour
    tree.shaderHooks = { leaves: app };
    app.mockClear();
    setSceneShaderHooks(snow); // the scene-wide default, under the Tree's own hook
    expect(reads(app.mock.calls[0]![0].color, sceneSnow.uniforms.amount)).toBe(true);
    tree.dispose();
  });

  it('takes its settings live (uniforms): no node graph is rebuilt', () => {
    const snow = new SnowCover({ color: '#eef4ff', slope: 50, softness: 0.2, strength: { fruit: 0.5 } });
    expect(snow.color.getHexString()).toBe('eef4ff');
    expect([snow.slope, snow.softness]).toEqual([50, 0.2]);
    expect(snow.strength).toEqual({ bark: 1, leaves: 1, fruit: 0.5 });
    const tree = createTree(stylized.apply(pear), { seed: 2, shaderHooks: snow });
    const versions = PARTS.map((part) => materialsOf(tree)[part].version);
    const nodes = PARTS.map((part) => materialsOf(tree)[part].colorNode);
    snow.color = 0xffffff;
    snow.slope = 30;
    snow.softness = 0.6;
    snow.strength = { leaves: 0 };
    expect(snow.set({ slope: 70 })).toBe(snow);
    expect(snow.color.getHex()).toBe(0xffffff);
    expect([snow.slope, snow.softness]).toEqual([70, 0.6]);
    expect(snow.strength).toEqual({ bark: 1, leaves: 0, fruit: 0.5 });
    expect(PARTS.map((part) => materialsOf(tree)[part].version)).toEqual(versions);
    expect(PARTS.map((part) => materialsOf(tree)[part].colorNode)).toEqual(nodes);
    tree.dispose();
  });

  it('rejects settings out of range', () => {
    const snow = new SnowCover();
    expect(() => (snow.slope = 95)).toThrow(RangeError);
    expect(() => (snow.slope = -1)).toThrow(RangeError);
    expect(() => (snow.softness = 1.5)).toThrow(RangeError);
    expect(() => (snow.strength = { bark: -0.5 })).toThrow(RangeError);
    expect(() => new SnowCover({ softness: Number.NaN })).toThrow(RangeError);
  });
});

describe('/weather packaging', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  it('is published as the @casmo/tree.js/weather subpath, built as its own chunk', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.exports['./weather']).toEqual({ types: './dist/weather/index.d.ts', import: './dist/weather.js' });
    expect(read('vite.config.ts')).toMatch(/weather: resolve\(import\.meta\.dirname, 'src\/weather\/index\.ts'\)/);
  });

  it('is imported by no other part of the library, so a game without weather never loads it', () => {
    const imports = /from '\.\.?\/(\.\.\/)*weather/;
    const files = readdirSync(new URL('../../src', import.meta.url), { recursive: true, encoding: 'utf8' });
    for (const file of files.filter((f) => /\.tsx?$/.test(f) && !f.startsWith('weather'))) {
      expect(read(`src/${file}`), file).not.toMatch(imports);
    }
    expect(read('src/index.ts')).not.toMatch(/weather/);
  });
});
