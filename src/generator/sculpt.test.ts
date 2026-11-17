import { Euler, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition, type Sculpt } from '../definition';
import { generateTree, hashTreeData, type Vec3 } from './index';

const def = parseDefinition({ schemaVersion: 2 });
const sculpted = (...sculpts: Sculpt[]) => extendDefinition(def, { sculpts });

describe('Sculpts (Seed-bound hand edits, ADR 0003)', () => {
  it('apply only on their Seed: every other Seed gives the unsculpted tree', () => {
    const withSculpt = sculpted({ seed: 7, path: '0.1', action: 'delete' });
    expect(hashTreeData(generateTree(withSculpt, 7))).not.toBe(hashTreeData(generateTree(def, 7)));
    for (const seed of [0, 1, 6, 8, 42]) {
      expect(hashTreeData(generateTree(withSculpt, seed))).toBe(hashTreeData(generateTree(def, seed)));
    }
  });

  it('delete removes the branch, everything growing from it and its leaves; other paths stay put', () => {
    const plain = generateTree(def, 7);
    const data = generateTree(sculpted({ seed: 7, path: '0.1', action: 'delete' }), 7);
    const gone = (path: string) => path === '0.1' || path.startsWith('0.1.');
    expect(data.skeleton.branches.some((b) => gone(b.path))).toBe(false);
    expect(data.skeleton.leaves.some((l) => gone(l.branch))).toBe(false);
    expect(data.skeleton.branches).toEqual(plain.skeleton.branches.filter((b) => !gone(b.path)));
    expect(data.skeleton.leaves.map((l) => l.id)).toEqual(plain.skeleton.leaves.filter((l) => !gone(l.branch)).map((l) => l.id));
    expect(data.wood.positions.length).toBeLessThan(plain.wood.positions.length);
  });

  it('move rotates (Euler XYZ, like three.js) and scales a branch and everything on it about its base', () => {
    const rotation: Vec3 = [0.3, -1.1, 0.7];
    const plain = generateTree(def, 7);
    const data = generateTree(sculpted({ seed: 7, path: '0.2', action: 'move', rotation, scale: 1.5 }), 7);
    const base = plain.skeleton.branches.find((b) => b.path === '0.2')!.points[0]!.position;
    const euler = new Euler(...rotation, 'XYZ');
    const moved = (p: Vec3) =>
      new Vector3(...p).sub(new Vector3(...base)).multiplyScalar(1.5).applyEuler(euler).add(new Vector3(...base)).toArray();
    const byPath = new Map(data.skeleton.branches.map((b) => [b.path, b]));
    expect(data.skeleton.branches.map((b) => b.path)).toEqual(plain.skeleton.branches.map((b) => b.path));
    for (const before of plain.skeleton.branches) {
      const after = byPath.get(before.path)!;
      if (!inSubtree(before.path, '0.2')) {
        expect(after).toEqual(before);
        continue;
      }
      before.points.forEach((p, i) => {
        expectClose(after.points[i]!.position, moved(p.position));
        expect(after.points[i]!.radius).toBe(p.radius); // a length scale: thickness stays
      });
      expectClose(after.direction, new Vector3(...before.direction).applyEuler(euler).toArray());
    }
    // Leaves are placed on the moved branches, so they move along.
    const leaves = new Map(data.skeleton.leaves.map((l) => [l.id, l]));
    for (const leaf of plain.skeleton.leaves) {
      const expected = inSubtree(leaf.branch, '0.2') ? moved(leaf.position) : leaf.position;
      expectClose(leaves.get(leaf.id)!.position, expected);
    }
  });

  it('leaves sets the leaf coverage of a branch and everything on it, keeping a stable subset of its leaves', () => {
    const plain = generateTree(def, 7).skeleton.leaves;
    const on = (root: string) => plain.filter((l) => inSubtree(l.branch, root));
    const leavesWith = (...sculpts: Sculpt[]) => generateTree(sculpted(...sculpts), 7).skeleton.leaves;

    const bare = leavesWith({ seed: 7, path: '0.1', action: 'leaves', coverage: 0 });
    expect(bare).toEqual(plain.filter((l) => !inSubtree(l.branch, '0.1')));

    const half = leavesWith({ seed: 7, path: '0', action: 'leaves', coverage: 0.5 });
    expect(half.length / plain.length).toBeGreaterThan(0.35);
    expect(half.length / plain.length).toBeLessThan(0.65);
    expect(plain.filter((l) => half.some((h) => h.id === l.id))).toEqual(half); // unchanged leaves, same order
    // Painting more coverage only adds leaves: the kept set grows monotonically.
    const more = leavesWith({ seed: 7, path: '0', action: 'leaves', coverage: 0.8 }).map((l) => l.id);
    for (const leaf of half) expect(more).toContain(leaf.id);

    // A later Sculpt on a sub-branch sets (not multiplies) its coverage.
    const restored = leavesWith(
      { seed: 7, path: '0', action: 'leaves', coverage: 0 },
      { seed: 7, path: '0.1', action: 'leaves', coverage: 1 },
    );
    expect(restored).toEqual(on('0.1'));
  });

  describe('a Sculpted tree still grows, changes with the Season and sways', () => {
    const sculpts: Sculpt[] = [
      { seed: 7, path: '0.1', action: 'delete' },
      { seed: 7, path: '0.2', action: 'move', rotation: [0, 0, 0.8], scale: 0.7 },
      { seed: 7, path: '0.3', action: 'leaves', coverage: 0.4 },
      { seed: 7, path: '0', action: 'move', rotation: [0.3, 0, 0], scale: 1 },
    ];
    const data = generateTree(sculpted(...sculpts), 7);
    const { branches, leaves } = data.skeleton;

    it('gives every remaining part a Growth window, parents before children, finishing at Growth 1', () => {
      expect(data.growth.branches).toHaveLength(branches.length);
      expect(data.growth.leaves).toHaveLength(leaves.length);
      const window = new Map(branches.map((b, i) => [b.path, data.growth.branches[i]!]));
      for (const b of branches) if (b.parent) expect(window.get(b.path)!.start).toBeGreaterThanOrEqual(window.get(b.parent)!.end);
      const ends = [...data.growth.branches, ...data.growth.leaves].map((w) => w.end);
      expect(Math.max(...ends)).toBeCloseTo(1, 6);
    });

    it('grows a moved branch from its new base (aOrigin) and fills Season and Wind attributes', () => {
      const moved = branches.find((b) => b.path === '0.2')!;
      const { aLevel, aAttach, aOrigin, aWind, aSeason } = data.wood.attributes;
      const origins = new Set<string>();
      for (let v = 0; v < aLevel.array.length; v++) origins.add([...aOrigin.array.subarray(v * 3, v * 3 + 3)].join());
      expect(origins).toContain(moved.points[0]!.position.map(Math.fround).join());
      expect(aAttach.array.length).toBe(data.wood.positions.length / 3);
      for (const buffers of [data.wood, data.leaves]) {
        for (const w of buffers.attributes.aWind.array) expect(w).toBeGreaterThanOrEqual(0);
        for (const w of buffers.attributes.aWind.array) expect(w).toBeLessThanOrEqual(1);
      }
      // The (tilted) trunk's tip still sways fully, the base not at all.
      const trunkSway = [...aLevel.array].flatMap((level, v) => (level === 0 ? [aWind.array[v * 3]!] : []));
      expect(Math.max(...trunkSway)).toBeCloseTo(1, 5);
      expect(Math.min(...trunkSway)).toBeCloseTo(0, 5);
      expect(aSeason.array.length).toBe(data.wood.positions.length);
      expect(data.leaves.attributes.aSeason.array.length).toBe(data.leaves.positions.length);
    });
  });

  it('deleting the trunk leaves an empty tree', () => {
    const data = generateTree(sculpted({ seed: 7, path: '0', action: 'delete' }), 7);
    expect(data.skeleton.branches).toEqual([]);
    expect(data.skeleton.leaves).toEqual([]);
    expect(data.wood.positions.length).toBe(0);
    expect(data.leaves.positions.length).toBe(0);
  });

  it('skips Sculpts whose branch does not exist for this Seed', () => {
    const missing = sculpted(
      { seed: 7, path: '0.99', action: 'delete' },
      { seed: 7, path: '0.1.2.3.4', action: 'move', rotation: [1, 0, 0], scale: 2 },
      { seed: 7, path: '0.42', action: 'leaves', coverage: 0 },
    );
    expect(hashTreeData(generateTree(missing, 7))).toBe(hashTreeData(generateTree(def, 7)));
  });
});

const inSubtree = (path: string, root: string) => path === root || path.startsWith(`${root}.`);

function expectClose(actual: readonly number[], expected: readonly number[]) {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9));
}
