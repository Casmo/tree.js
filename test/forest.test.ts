import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { createForest, UnsupportedRendererError, type Forest, type ForestPlacement, type TreeDefinitionInput } from '../src/index';

// A small tree keeps Variant generation fast.
const definition: TreeDefinitionInput = {
  schemaVersion: 2,
  branches: [{ count: 3 }],
  leaves: { count: 2 },
};

function grid(n: number): ForestPlacement[] {
  const out: ForestPlacement[] = [];
  for (let i = 0; i < n; i++) out.push({ position: [(i % 50) * 3, 0, Math.floor(i / 50) * 3] });
  return out;
}

/** What each tree looks like, by key: its Variant and its offsets. */
function looks(forest: Forest) {
  return Object.fromEntries(
    forest.trees.map((t) => [t.key, { variant: t.variant, growthDelay: t.growthDelay, seasonShift: t.seasonShift, windPhase: t.windPhase }]),
  );
}

function meshes(forest: Forest): Mesh[] {
  const out: Mesh[] = [];
  forest.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

/** World-space positions of every drawn instance of every Variant (sorted, rounded). */
function drawnPositions(forest: Forest): string[] {
  const out: string[] = [];
  const m = new Matrix4();
  const p = new Vector3();
  for (const variant of forest.variants) {
    for (let i = 0; i < variant.wood.count; i++) {
      variant.wood.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.push(`${variant.index}:${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`);
    }
  }
  return out.sort();
}

describe('createForest', () => {
  it('gives the same forest for the same forest seed and placements', () => {
    const a = createForest(definition, grid(40), { variants: 3, seed: 7 });
    const b = createForest(definition, grid(40), { variants: 3, seed: 7 });
    expect(looks(a)).toEqual(looks(b));
    expect(a.variants.map((v) => v.seed)).toEqual(b.variants.map((v) => v.seed));
    expect(drawnPositions(a)).toEqual(drawnPositions(b));
    // ...and a different forest seed gives a different forest.
    const c = createForest(definition, grid(40), { variants: 3, seed: 8 });
    expect(looks(c)).not.toEqual(looks(a));
  });

  it('spreads trees over all Variants with small Growth/Season offsets', () => {
    const forest = createForest(definition, grid(200), { variants: 4, seed: 1 });
    const used = new Set(forest.trees.map((t) => t.variant));
    expect([...used].sort()).toEqual([0, 1, 2, 3]);
    for (const t of forest.trees) {
      expect(t.growthDelay).toBeGreaterThanOrEqual(0);
      expect(t.growthDelay).toBeLessThanOrEqual(0.1); // default variation.growth
      expect(Math.abs(t.seasonShift)).toBeLessThanOrEqual(0.05); // default variation.season
      expect(t.windPhase).toBeGreaterThanOrEqual(0);
      expect(t.windPhase).toBeLessThan(Math.PI * 2);
    }
    expect(new Set(forest.trees.map((t) => t.seasonShift)).size).toBeGreaterThan(100);
  });

  it('takes Variant and offsets from the id (or position), never from the index in the list', () => {
    const placements: ForestPlacement[] = [
      { id: 'oak-1', position: [0, 0, 0] },
      { id: 'oak-2', position: [5, 0, 0] },
      { position: [10, 0, 2] },
    ];
    const forward = createForest(definition, placements, { variants: 5, seed: 3 });
    const backward = createForest(definition, [...placements].reverse(), { variants: 5, seed: 3 });
    expect(looks(backward)).toEqual(looks(forward));
    // An id goes with the tree wherever it is placed.
    const moved = createForest(definition, [{ id: 'oak-1', position: [40, 0, 40] }], { variants: 5, seed: 3 });
    expect(moved.get('oak-1')!.variant).toBe(forward.get('oak-1')!.variant);
    expect(moved.get('oak-1')!.growthDelay).toBe(forward.get('oak-1')!.growthDelay);
  });

  it('adding or removing trees leaves every other tree unchanged', () => {
    const forest = createForest(definition, grid(60), { variants: 4, seed: 11 });
    const before = looks(forest);
    const removed = forest.trees.filter((_, i) => i % 3 === 0).map((t) => t.key);
    for (const key of removed) expect(forest.removeTree(key)).toBe(true);
    const added = forest.addTree({ id: 'new', position: [500, 0, 500], rotation: 1, scale: 1.5 });
    const after = looks(forest);
    for (const key of Object.keys(before)) {
      if (removed.includes(key)) expect(after[key]).toBeUndefined();
      else expect(after[key]).toEqual(before[key]);
    }
    expect(after[added.key]).toBeDefined();
    expect(forest.size).toBe(60 - removed.length + 1);
    // The trees drawn are exactly the trees in the forest.
    const fresh = createForest(definition, [...grid(60).filter((_, i) => i % 3 !== 0), { id: 'new', position: [500, 0, 500], rotation: 1, scale: 1.5 }], {
      variants: 4,
      seed: 11,
    });
    expect(drawnPositions(forest)).toEqual(drawnPositions(fresh));
    expect(forest.removeTree('no-such-tree')).toBe(false);
  });

  it('rejects two trees with the same id, or the same position and no id', () => {
    expect(() => createForest(definition, [{ id: 1, position: [0, 0, 0] }, { id: 1, position: [1, 0, 0] }])).toThrow(/id/);
    expect(() => createForest(definition, [{ position: [0, 0, 0] }, { position: [0, 0, 0] }])).toThrow(/position/);
  });

  it('draws thousands of trees with one instanced mesh per Variant and material', () => {
    const forest = createForest(definition, grid(3000), { variants: 4, seed: 2 });
    const drawn = meshes(forest);
    expect(drawn).toHaveLength(4 * 2);
    for (const mesh of drawn) expect(mesh).toBeInstanceOf(InstancedMesh);
    const total = forest.variants.reduce((sum, v) => sum + v.wood.count, 0);
    expect(total).toBe(3000);
    for (const v of forest.variants) expect(v.leaves.count).toBe(v.wood.count);
  });

  it('keeps growing past its initial capacity', () => {
    const forest = createForest(definition, [], { variants: 2, seed: 2 });
    for (let i = 0; i < 300; i++) forest.addTree({ position: [i, 0, 0] });
    expect(forest.variants.reduce((sum, v) => sum + v.wood.count, 0)).toBe(300);
    expect(drawnPositions(forest)).toEqual(drawnPositions(createForest(definition, Array.from({ length: 300 }, (_, i) => ({ position: [i, 0, 0] as const })), { variants: 2, seed: 2 })));
    expect(meshes(forest)).toHaveLength(4);
  });

  it('places each tree with its position, rotation and scale', () => {
    const forest = createForest(definition, [{ id: 'a', position: [1, 2, 3], rotation: [0, Math.PI / 2, 0], scale: 2 }], { seed: 1 });
    const tree = forest.get('a')!;
    const variant = forest.variants[tree.variant]!;
    const m = new Matrix4();
    variant.wood.getMatrixAt(0, m);
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    m.decompose(p, q, s);
    expect(p.toArray()).toEqual([1, 2, 3]);
    expect(s.x).toBeCloseTo(2);
    expect(s.y).toBeCloseTo(2);
    expect(new Vector3(1, 0, 0).applyQuaternion(q).z).toBeCloseTo(-1);
    // A number is a rotation about the vertical axis.
    const yaw = createForest(definition, [{ id: 'a', position: [0, 0, 0], rotation: Math.PI / 2 }], { seed: 1 });
    const v2 = yaw.variants[yaw.get('a')!.variant]!;
    v2.wood.getMatrixAt(0, m);
    expect(new Vector3(1, 0, 0).applyMatrix4(m).z).toBeCloseTo(-1);
  });

  it('sets Growth and Season per tree, or for the whole forest', () => {
    const forest = createForest(definition, grid(10), { variants: 2, seed: 4, growth: 0.5, season: 0.3 });
    const [first, second] = forest.trees as [Forest['trees'][number], Forest['trees'][number]];
    expect(first.growth).toBe(0.5);
    expect(first.season).toBe(0.3);
    first.growth = 0.2;
    first.season = 0.8;
    expect(first.growth).toBe(0.2);
    expect(first.season).toBe(0.8);
    expect(second.growth).toBe(0.5);
    // Growth clamps, Season wraps (as on Tree).
    first.growth = 3;
    expect(first.growth).toBe(1);
    first.season = 1.25;
    expect(first.season).toBeCloseTo(0.25);
    expect(() => (first.season = Number.NaN)).toThrow(RangeError);

    forest.growth = 0.9;
    forest.season = 0.6;
    expect(forest.trees.every((t) => t.growth === 0.9 && t.season === 0.6)).toBe(true);
  });

  it('writes per-tree Growth and Season (with the tree offsets) into the per-instance data', () => {
    const forest = createForest(definition, grid(20), { variants: 2, seed: 4, growth: 1, season: 0.5 });
    const tree = forest.trees[5]!;
    const read = () => forest.instanceState(tree.key);
    // Growth 1 is fully grown for every tree; Growth 0 is a sapling for every tree.
    expect(read().growth).toBe(1);
    tree.growth = 0;
    expect(read().growth).toBe(0);
    tree.growth = 0.5;
    expect(read().growth).toBeLessThanOrEqual(0.5);
    expect(read().growth).toBeCloseTo((0.5 - tree.growthDelay) / (1 - tree.growthDelay), 5);
    expect(read().season).toBeCloseTo(0.5 + tree.seasonShift, 5);
    expect(read().windPhase).toBeCloseTo(tree.windPhase, 5);
    // Other trees keep theirs.
    expect(forest.instanceState(forest.trees[6]!.key).growth).toBe(1);
  });

  it('dispose() frees every geometry and material and removes the forest', () => {
    const forest = createForest(definition, grid(30), { variants: 3, seed: 1 });
    const parent = new Object3D();
    parent.add(forest);
    const disposed: string[] = [];
    for (const mesh of meshes(forest)) {
      mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'));
      (mesh.material as Mesh['material'] & { addEventListener: Mesh['addEventListener'] }).addEventListener('dispose', () =>
        disposed.push('material'),
      );
    }
    let instancesDisposed = 0;
    for (const mesh of meshes(forest)) mesh.addEventListener('dispose', () => instancesDisposed++);
    forest.dispose();
    expect(disposed.filter((d) => d === 'geometry')).toHaveLength(6);
    expect(disposed.filter((d) => d === 'material')).toHaveLength(6);
    expect(instancesDisposed).toBe(6);
    expect(forest.parent).toBeNull();
  });

  it('throws a clear error when drawn by the classic WebGLRenderer', () => {
    const forest = createForest(definition, grid(3), { seed: 1 });
    const mesh = meshes(forest)[0]!;
    const draw = () => (mesh.onBeforeRender as (...args: unknown[]) => void)({ isWebGLRenderer: true }, null, null, mesh.geometry, mesh.material, null);
    expect(draw).toThrow(UnsupportedRendererError);
  });
});
