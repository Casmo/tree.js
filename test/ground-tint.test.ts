// Ground Tint (#49): an optional `materials.bark.groundTint` that blends the bark towards a colour
// near the ground, fading out at `height` metres up the Stem.
import { describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three/webgpu';
import {
  bakeTree,
  createTree,
  DEFAULT_GROUND_TINT,
  extendDefinition,
  hexToLinear,
  parseDefinition,
  TreeDefinitionError,
  type TreeDefinition,
} from '../src/index';
import * as allSpecies from '../src/species';
import { oak, type SpeciesDefinition } from '../src/species';
import lowPoly from '../src/styles/low-poly';
import realistic from '../src/styles/realistic';
import stylized from '../src/styles/stylized';

const withTint = (groundTint: unknown) => ({ schemaVersion: 3, materials: { bark: { groundTint } } });

describe('Ground Tint in the Definition', () => {
  it('is absent unless given', () => {
    expect(parseDefinition({ schemaVersion: 3 }).materials.bark).not.toHaveProperty('groundTint');
  });

  it('fills the missing fields of a partial block from DEFAULT_GROUND_TINT (height 0.5 m)', () => {
    expect(DEFAULT_GROUND_TINT.height).toBe(0.5);
    expect(parseDefinition(withTint({})).materials.bark.groundTint).toEqual(DEFAULT_GROUND_TINT);
    expect(parseDefinition(withTint({ color: '#223311' })).materials.bark.groundTint).toEqual({ ...DEFAULT_GROUND_TINT, color: '#223311' });
  });

  it('keeps a complete block, at the edges of its ranges too', () => {
    for (const groundTint of [
      { color: '#4a5a2a', height: 0.01, strength: 0 },
      { color: '#000000', height: 12, strength: 1 },
    ]) {
      expect(parseDefinition(withTint(groundTint)).materials.bark.groundTint).toEqual(groundTint);
    }
  });

  it.each([
    ['color', { color: 'green' }],
    ['color', { color: '#12345' }],
    ['height', { height: 0 }],
    ['height', { height: -0.5 }],
    ['height', { height: '1' }],
    ['strength', { strength: -0.1 }],
    ['strength', { strength: 1.5 }],
    ['fade', { fade: 1 }],
  ])('rejects an invalid or unknown groundTint.%s', (field, groundTint) => {
    expect(() => parseDefinition(withTint(groundTint))).toThrow(TreeDefinitionError);
    expect(() => parseDefinition(withTint(groundTint))).toThrow(`materials.bark.groundTint.${field}`);
  });
});

describe('Ground Tint and Styles', () => {
  it('no Species sets one', () => {
    for (const species of Object.values(allSpecies).filter((v): v is SpeciesDefinition => typeof v === 'object' && v !== null && 'bark' in v)) {
      expect(lowPoly.apply(species).materials.bark, species.id).not.toHaveProperty('groundTint');
    }
  });

  it('survives re-styling a Definition (it is not part of the look)', () => {
    const tint = { color: '#2f3a1c', height: 0.8, strength: 0.7 };
    const tinted = extendDefinition(lowPoly.apply(oak), { materials: { bark: { groundTint: tint } } });
    expect(realistic.apply(tinted).materials.bark.groundTint).toEqual(tint);
    expect(stylized.apply(tinted).materials.bark.groundTint).toEqual(tint);
  });
});

describe('Ground Tint on a Baked Tree', () => {
  const RED = { color: '#ff0000', height: 1, strength: 1 };
  /** Per wood vertex: grown height and final colour (material colour x vertex colour). */
  function bakedWood(definition: TreeDefinition, growth = 1) {
    const tree = createTree(definition, { seed: 4, growth });
    const wood = bakeTree(tree).getObjectByName('wood') as Mesh;
    tree.dispose();
    const material = wood.material as MeshStandardMaterial;
    const position = wood.geometry.getAttribute('position');
    const color = wood.geometry.getAttribute('color');
    return Array.from({ length: position.count }, (_, v) => ({
      y: position.getY(v),
      rgb: [material.color.r, material.color.g, material.color.b].map((c, i) => c * (color ? color.getComponent(v, i) : 1)),
    }));
  }

  it.each(['standard', 'flat', 'toon'] as const)('bakes the tint into the wood vertex colours (%s shading)', (shading) => {
    const plain = extendDefinition(lowPoly.apply(oak), { materials: { shading } });
    const tinted = extendDefinition(plain, { materials: { bark: { groundTint: RED } } });
    const before = bakedWood(plain);
    const after = bakedWood(tinted);
    expect(after.length).toBe(before.length);
    const ground = after.filter((v) => v.y <= 0);
    const high = after.map((v, i) => [v, before[i]!] as const).filter(([v]) => v.y >= RED.height);
    expect(ground.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    // At and below the ground: all the way to the tint (strength 1).
    for (const v of ground) expect(v.rgb.map((c) => +c.toFixed(4))).toEqual([1, 0, 0]);
    // From `height` up: the bark as without a tint.
    for (const [v, was] of high) expect(v.rgb.map((c) => +c.toFixed(4))).toEqual(was.rgb.map((c) => +c.toFixed(4)));
    // In between: part way.
    const mid = after.find((v) => v.y > 0.3 && v.y < 0.7)!;
    expect(mid.rgb[0]).toBeGreaterThan(mid.rgb[1]!);
    expect(mid.rgb[0]).toBeLessThan(1);
  });

  it('blends by strength', () => {
    const half = bakedWood(extendDefinition(lowPoly.apply(oak), { materials: { bark: { groundTint: { ...RED, strength: 0.5 } } } }));
    const bark = hexToLinear(lowPoly.apply(oak).materials.bark.color);
    for (const v of half.filter((v) => v.y <= 0)) {
      expect(v.rgb.map((c) => +c.toFixed(4))).toEqual([0.5 + bark[0] * 0.5, bark[1] * 0.5, bark[2] * 0.5].map((c) => +c.toFixed(4)));
    }
  });

  it('is measured on the grown tree: a sapling is tinted up to `height` metres of its own, smaller trunk', () => {
    const tint = { ...RED, height: 0.6 };
    const tinted = extendDefinition(realistic.apply(oak), { materials: { bark: { groundTint: tint } } });
    const sapling = bakedWood(tinted, 0);
    expect(Math.max(...sapling.map((v) => v.y))).toBeLessThan(1); // the sapling trunk is about 1 m tall (full grown: several m)
    const shown = sapling.filter((v) => v.y > 0.25 && v.y < 0.35);
    expect(shown.length).toBeGreaterThan(0);
    // Half way up the tint: about half red (smoothstep(0.5) = 0.5), on the sapling's own height.
    for (const v of shown) expect(v.rgb[0]).toBeGreaterThan(0.35);
    for (const v of sapling.filter((v) => v.y >= tint.height)) expect(v.rgb[0]).toBeLessThan(0.35);
  });

  it('without a Ground Tint the wood colours are as before', () => {
    const tree = createTree(lowPoly.apply(oak), { seed: 4 });
    const wood = bakeTree(tree).getObjectByName('wood') as Mesh;
    expect(wood.geometry.hasAttribute('color')).toBe(false); // flat shading: plain bark colour
    expect((wood.material as MeshStandardMaterial).color.getHexString()).toBe(lowPoly.apply(oak).materials.bark.color.slice(1));
    tree.dispose();
  });
});
