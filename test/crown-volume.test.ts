// Crown Volume (#53, GLOSSARY): one axis-aligned ellipsoid around all leaves of the fully grown tree,
// stored next to the geometry as `TreeData.crown`.
import { describe, expect, it } from 'vitest';
import { generateTree } from '../src/generator';
import {
  crownDistance,
  crownNormal,
  extendDefinition,
  hashTreeData,
  parseDefinition,
  type CrownVolume,
  type TreeData,
  type TreeDefinition,
  type Vec3,
} from '../src/index';
import * as allSpecies from '../src/species';
import { juniper, oak, olive, spruce, type SpeciesDefinition } from '../src/species';
import lowPoly from '../src/styles/low-poly';
import realistic from '../src/styles/realistic';
import stylized from '../src/styles/stylized';

const STYLES = [lowPoly, stylized, realistic];
const SPECIES = Object.values(allSpecies).filter((v): v is SpeciesDefinition => typeof v === 'object' && v !== null && 'bark' in v);

/** Every leaf vertex of the fully grown tree. */
function leafVertices(data: TreeData): Vec3[] {
  const p = data.leaves.positions;
  return Array.from({ length: p.length / 3 }, (_, v) => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!]);
}

/** Half the extent of the points along each axis. */
function halfSpread(points: Vec3[]): Vec3 {
  return [0, 1, 2].map((i) => (Math.max(...points.map((p) => p[i]!)) - Math.min(...points.map((p) => p[i]!))) / 2) as Vec3;
}

/** The distance a point sits from the centre, in units of the ellipsoid (computed here independently). */
const inUnits = ({ center, radii }: CrownVolume, p: Vec3) => Math.hypot(...[0, 1, 2].map((i) => (p[i]! - center[i]!) / radii[i]!));

describe('Crown Volume', () => {
  const cases = STYLES.flatMap((style) =>
    [oak, spruce, juniper, ...SPECIES.filter((_, i) => i % 5 === 0)].map((s) => [`${style.name} ${s.id}`, style.apply(s)] as const),
  );

  it.each(cases)('contains every leaf of the fully grown tree and touches the outermost ones (%s)', (_, definition) => {
    const data = generateTree(definition, 7);
    const distances = leafVertices(data).map((p) => inUnits(data.crown, p));
    expect(Math.max(...distances)).toBeLessThanOrEqual(1 + 1e-6);
    expect(Math.max(...distances)).toBeGreaterThan(0.999);
  });

  it.each(cases)('is tight: each radius is close to the leaf spread, well inside the bounding box\'s ellipsoid (%s)', (_, definition) => {
    const data = generateTree(definition, 7);
    const spread = halfSpread(leafVertices(data));
    const { radii } = data.crown;
    // The ellipsoid around the bounding box has radii sqrt(3) x the half spread: the Volume is narrower on
    // every axis and much smaller overall (a minimum-volume fit may trade a little width on one axis).
    for (let i = 0; i < 3; i++) {
      expect(radii[i]).toBeGreaterThanOrEqual(spread[i]! * (1 - 1e-6));
      expect(radii[i]).toBeLessThan(spread[i]! * Math.sqrt(3));
    }
    const boxEllipsoid = spread.reduce((v, s) => v * s * Math.sqrt(3), 1);
    expect(radii[0] * radii[1] * radii[2]).toBeLessThan(boxEllipsoid * 0.6);
  });

  it('is deterministic per Definition and Seed', () => {
    const definition = realistic.apply(oak);
    expect(generateTree(definition, 3).crown).toEqual(generateTree(definition, 3).crown);
    expect(generateTree(definition, 3).crown).not.toEqual(generateTree(definition, 4).crown);
  });

  it.each([juniper, olive])('is one Volume around the leaves of every Stem of a multi-Stem tree (%s)', (species) => {
    const definition = stylized.apply(species);
    expect(definition.trunk.stems).toBeGreaterThan(1);
    const data = generateTree(definition, 5);
    const crown = data.crown;
    const stems = new Set(data.skeleton.leaves.map((l) => l.branch.split('.')[0]));
    expect(stems.size).toBe(definition.trunk.stems);
    for (const stem of stems) {
      const leaves = data.skeleton.leaves.filter((l) => l.branch.split('.')[0] === stem);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) expect(inUnits(crown, leaf.position)).toBeLessThanOrEqual(1 + 1e-6);
    }
    // One Volume around them all: it spans the leaves of every Stem together.
    const all = halfSpread(leafVertices(data));
    expect(Math.max(crown.radii[0], crown.radii[2])).toBeGreaterThanOrEqual(Math.max(all[0], all[2]) * (1 - 1e-6));
  });

  it('is plain numbers next to the geometry: the hash and the attributes do not change', () => {
    const definition = lowPoly.apply(oak);
    const data = generateTree(definition, 9);
    const { crown, ...rest } = data;
    expect(JSON.parse(JSON.stringify(crown))).toEqual(crown);
    expect(hashTreeData({ ...rest, crown: { center: [0, 0, 0], radii: [1, 1, 1] } })).toBe(hashTreeData(data));
    // Leaves carry the wood's attributes plus the twig they ride on (ADR 0020).
    expect(Object.keys(data.leaves.attributes).sort()).toEqual([...Object.keys(generateTree(definition, 9).wood.attributes), 'aTwigGrowth', 'aTwigOrigin'].sort());
  });

  it('does not depend on the Material Features or the Season', () => {
    const definition = realistic.apply(oak);
    const opted: TreeDefinition = extendDefinition(definition, {
      materials: { leaf: { crownNormals: 1, translucency: { strength: 1 } }, occlusion: { strength: 1 } },
      season: { leafCoverage: [{ t: 0, value: 0.2 }] },
    });
    expect(generateTree(opted, 2).crown).toEqual(generateTree(definition, 2).crown);
  });

  it('is still a finite Volume around the branches for a tree without leaves', () => {
    const bare = parseDefinition({ schemaVersion: 3, leaves: { count: 0 } });
    const data = generateTree(bare, 1);
    expect(data.leaves.positions.length).toBe(0);
    const { center, radii } = data.crown;
    for (const v of [...center, ...radii]) expect(Number.isFinite(v)).toBe(true);
    for (const r of radii) expect(r).toBeGreaterThan(0);
    for (const branch of data.skeleton.branches.filter((b) => b.level > 0)) {
      for (const point of branch.points) expect(inUnits(data.crown, point.position)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('measuring a point against the Crown Volume', () => {
  const crown: CrownVolume = { center: [1, 5, -2], radii: [2, 4, 1] };

  it('crownDistance is 0 at the centre, 1 on the shell, and grows outside it', () => {
    expect(crownDistance(crown, [1, 5, -2])).toBe(0);
    expect(crownDistance(crown, [3, 5, -2])).toBeCloseTo(1, 12);
    expect(crownDistance(crown, [1, 1, -2])).toBeCloseTo(1, 12);
    expect(crownDistance(crown, [1, 5, -1.5])).toBeCloseTo(0.5, 12);
    expect(crownDistance(crown, [1 + 2 * 0.6, 5 + 4 * 0.8, -2])).toBeCloseTo(1, 12);
    expect(crownDistance(crown, [5, 5, -2])).toBeCloseTo(2, 12);
  });

  it('crownNormal is the unit outward normal of the ellipsoid through the point', () => {
    const near = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12));
    near(crownNormal(crown, [3, 5, -2]), [1, 0, 0]);
    near(crownNormal(crown, [1, 1, -2]), [0, -1, 0]);
    near(crownNormal(crown, [1, 5, -1.5]), [0, 0, 1]);
    // On the shell at (cos 45°, sin 45°) in x/y: the gradient (x / rx², y / ry²) is (1/(2√2), 1/(4√2)) ~ (2, 1).
    const s = Math.SQRT1_2;
    near(crownNormal(crown, [1 + 2 * s, 5 + 4 * s, -2]), [2 / Math.sqrt(5), 1 / Math.sqrt(5), 0]);
    // At the centre there is no direction: straight up.
    near(crownNormal(crown, [1, 5, -2]), [0, 1, 0]);
  });
});
