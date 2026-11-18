import { describe, expect, it } from 'vitest';
import { extendDefinition, parseDefinition } from '../definition';
import { growPositions } from '../growth/evaluate';
import { generateTree, hashGeometry, hashTreeData } from './index';

const plain = parseDefinition({ schemaVersion: 3, branches: [{ count: 5 }, { count: 3, start: 0.2 }] });
const fruiting = parseDefinition({
  schemaVersion: 3,
  branches: [{ count: 5 }, { count: 3, start: 0.2 }],
  fruit: { type: 'round', count: 2, size: 0.12, sizeVariation: 0.2, hang: 0.6 },
});

describe('Fruit placement', () => {
  it('grows `count` Fruit on every outermost twig and none elsewhere', () => {
    const { skeleton } = generateTree(fruiting, 7);
    const twigs = skeleton.branches.filter((b) => b.level === 2);
    expect(twigs.length).toBe(15);
    expect(skeleton.fruit).toHaveLength(twigs.length * 2);
    for (const twig of twigs) expect(skeleton.fruit.filter((f) => f.branch === twig.path)).toHaveLength(2);
  });

  it('a Definition without Fruit grows none and has an empty fruit mesh', () => {
    const data = generateTree(plain, 7);
    expect(data.skeleton.fruit).toEqual([]);
    expect(data.fruit.positions).toHaveLength(0);
    expect(data.fruit.indices).toHaveLength(0);
  });
});

/** Per Fruit: the vertex index range in the fruit mesh (every Fruit has the same vertex count). */
function fruitVertices(data: ReturnType<typeof generateTree>): number[][] {
  const count = data.fruit.positions.length / 3;
  const per = count / data.skeleton.fruit.length;
  return data.skeleton.fruit.map((_, f) => Array.from({ length: per }, (_, i) => f * per + i));
}

function centre(positions: ArrayLike<number>, vertices: number[]): [number, number, number] {
  const c = [0, 0, 0];
  for (const v of vertices) for (let k = 0; k < 3; k++) c[k]! += positions[v * 3 + k]! / vertices.length;
  return c as [number, number, number];
}

describe('Fruit hang', () => {
  /** Mean height of the Fruit centres below their attachment points, in Fruit sizes. */
  function drop(hang: number): number {
    const data = generateTree(extendDefinition(fruiting, { fruit: { hang } }), 7);
    const vertices = fruitVertices(data);
    const drops = data.skeleton.fruit.map((f, i) => (f.position[1] - centre(data.fruit.positions, vertices[i]!)[1]) / f.size);
    return drops.reduce((a, b) => a + b, 0) / drops.length;
  }

  it('hanging Fruit dangles below its twig; more hang, further down', () => {
    expect(drop(1)).toBeGreaterThan(0.45);
    expect(drop(1)).toBeGreaterThan(drop(0.5));
    expect(drop(0.5)).toBeGreaterThan(drop(0));
  });

  it('Fruit hangs from its twig: every Fruit touches its attachment point', () => {
    const data = generateTree(fruiting, 7);
    fruitVertices(data).forEach((vertices, i) => {
      const f = data.skeleton.fruit[i]!;
      const nearest = Math.min(
        ...vertices.map((v) => Math.hypot(...[0, 1, 2].map((k) => data.fruit.positions[v * 3 + k]! - f.position[k]!))),
      );
      expect(nearest).toBeLessThan(f.size * 0.15);
    });
  });
});

describe('Fruit is its own tree part', () => {
  it('adding Fruit leaves the wood and leaf buffers byte-identical', () => {
    for (const seed of [1, 7, 42]) {
      const without = generateTree(plain, seed);
      const withFruit = generateTree(fruiting, seed);
      expect(hashGeometry(withFruit.wood)).toBe(hashGeometry(without.wood));
      expect(hashGeometry(withFruit.leaves)).toBe(hashGeometry(without.leaves));
      expect(withFruit.skeleton.branches).toEqual(without.skeleton.branches);
      expect(hashTreeData(withFruit)).not.toBe(hashTreeData(without));
    }
  });

  it('every Fruit Type grows a closed, well-formed solid', () => {
    for (const type of ['round', 'pear', 'nut', 'cone', 'berry'] as const) {
      const { fruit } = generateTree(extendDefinition(fruiting, { fruit: { type } }), 3);
      const vertexCount = fruit.positions.length / 3;
      expect(vertexCount).toBeGreaterThan(0);
      expect(fruit.indices.length % 3).toBe(0);
      for (const i of fruit.indices) expect(i).toBeLessThan(vertexCount);
      expect(fruit.colors!.length).toBe(fruit.positions.length);
    }
  });

  it('a Sculpt that deletes a branch takes its Fruit with it', () => {
    const twig = generateTree(fruiting, 7).skeleton.fruit[0]!.branch;
    const parent = twig.split('.').slice(0, 2).join('.');
    const sculpted = extendDefinition(fruiting, { sculpts: [{ action: 'delete', seed: 7, path: parent }] });
    const { fruit } = generateTree(sculpted, 7).skeleton;
    expect(fruit.length).toBeGreaterThan(0);
    for (const f of fruit) expect(f.branch.startsWith(`${parent}.`)).toBe(false);
  });
});

describe('Fruit and Growth', () => {
  /** Largest Fruit extent (max distance of a vertex from its Fruit's centre) at Growth g, in metres. */
  function largestFruit(g: number): number {
    const data = generateTree(fruiting, 7);
    const grown = growPositions(data.fruit, g);
    return Math.max(
      ...fruitVertices(data).map((vertices) => {
        const c = centre(grown, vertices);
        return Math.max(...vertices.map((v) => Math.hypot(...[0, 1, 2].map((k) => grown[v * 3 + k]! - c[k]!))));
      }),
    );
  }

  it('a sapling or half-grown tree bears no Fruit; a fully grown tree does', () => {
    expect(largestFruit(0)).toBeCloseTo(0, 9);
    expect(largestFruit(0.5)).toBeCloseTo(0, 9);
    expect(largestFruit(0.85)).toBeCloseTo(0, 9);
    expect(largestFruit(1)).toBeGreaterThan(0.05);
  });

  it('Fruit grows only after its twig is fully grown', () => {
    const data = generateTree(fruiting, 7);
    const twig = new Map(data.skeleton.branches.map((b, i) => [b.path, data.growth.branches[i]!]));
    expect(data.growth.fruit).toHaveLength(data.skeleton.fruit.length);
    data.skeleton.fruit.forEach((f, i) => {
      expect(data.growth.fruit[i]!.start).toBeGreaterThanOrEqual(twig.get(f.branch)!.end);
      expect(data.growth.fruit[i]!.start).toBeGreaterThanOrEqual(0.9);
      expect(data.growth.fruit[i]!.end).toBe(1);
    });
  });
});

describe('Fruit and Wind', () => {
  it('Fruit sways with its twig: the twig\'s branch sway at the attachment point, no flutter', () => {
    const data = generateTree(fruiting, 7);
    const { aWind, aOrigin, aAlong } = data.wood.attributes;
    fruitVertices(data).forEach((vertices, i) => {
      const f = data.skeleton.fruit[i]!;
      const twig = data.skeleton.branches.find((b) => b.path === f.branch)!;
      // The twig's wood vertices at its base and tip give its branch sway there.
      const twigVertices = [...Array(aAlong.array.length).keys()].filter(
        (v) => [0, 1, 2].every((k) => Math.abs(aOrigin.array[v * 3 + k]! - twig.points[0]!.position[k]!) < 1e-6),
      );
      const at = (along: number) => aWind.array[twigVertices.find((v) => aAlong.array[v] === along)! * 3 + 1]!;
      const expected = at(0) + (at(1) - at(0)) * f.attach;
      for (const v of vertices) {
        expect(data.fruit.attributes.aWind.array[v * 3 + 1]).toBeCloseTo(expected, 5);
        expect(data.fruit.attributes.aWind.array[v * 3 + 2]).toBe(0);
      }
      expect(expected).toBeGreaterThan(0);
    });
  });
});
