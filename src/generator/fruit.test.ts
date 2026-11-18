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

  it('a fractional count is a chance per twig: count 0.4 puts one Fruit on about 40% of the twigs, the same ones every time', () => {
    const many = extendDefinition(fruiting, { branches: [{ count: 12 }, { count: 6, start: 0.2 }], fruit: { count: 0.4 } });
    const { skeleton } = generateTree(many, 7);
    const twigs = skeleton.branches.filter((b) => b.level === 2);
    const bearing = new Set(skeleton.fruit.map((f) => f.branch));
    for (const twig of twigs) expect(skeleton.fruit.filter((f) => f.branch === twig.path).length).toBeLessThanOrEqual(1);
    expect(bearing.size / twigs.length).toBeGreaterThan(0.25);
    expect(bearing.size / twigs.length).toBeLessThan(0.55);
    expect(generateTree(many, 7).skeleton.fruit).toEqual(skeleton.fruit);
    // A higher chance keeps the Fruit a lower one had (it only adds).
    const more = generateTree(extendDefinition(many, { fruit: { count: 0.7 } }), 7).skeleton.fruit.map((f) => f.branch);
    for (const branch of bearing) expect(more).toContain(branch);
  });

  it('count 1.5: every twig bears one Fruit, about half of them a second', () => {
    const { skeleton } = generateTree(extendDefinition(fruiting, { fruit: { count: 1.5 } }), 7);
    const twigs = skeleton.branches.filter((b) => b.level === 2);
    const perTwig = twigs.map((twig) => skeleton.fruit.filter((f) => f.branch === twig.path).length);
    expect(Math.min(...perTwig)).toBe(1);
    expect(Math.max(...perTwig)).toBe(2);
  });

  it('whole counts grow exactly the Fruit they always did (geometry hashes recorded before fractional counts)', () => {
    const golden = {
      round: ['ecc9c2af', '92926766', '3a86c9c1'],
      pear: ['cce68946', '5bd721da', '696d526e'],
      nut: ['336d52ec', '3e0b8f65', '37b5224c'],
      cone: ['0e75bb6d', '0094b511', '967da706'],
      berry: ['4bfe3b6f', 'f9722ea0', '8306ffc1'],
    } as const;
    for (const [type, hashes] of Object.entries(golden)) {
      const definition = extendDefinition(fruiting, { fruit: { type: type as keyof typeof golden } });
      expect([1, 7, 42].map((seed) => hashTreeData(generateTree(definition, seed))), type).toEqual(hashes);
    }
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

  it('fewer `sides` draw every Fruit Type with fewer, flat-faceted triangles (low-poly Fruit)', () => {
    const perFruit = (fruit: Partial<NonNullable<typeof fruiting.fruit>>) => {
      const data = generateTree(extendDefinition(fruiting, { fruit }), 3);
      return data.fruit.indices.length / 3 / data.skeleton.fruit.length;
    };
    for (const type of ['round', 'pear', 'nut', 'cone', 'berry'] as const) {
      expect(perFruit({ type, sides: 4 }), type).toBeLessThanOrEqual(24);
      expect(perFruit({ type, sides: 4 }), type).toBeLessThan(perFruit({ type, sides: 6 }));
      expect(perFruit({ type, sides: 6 }), type).toBeLessThanOrEqual(perFruit({ type, sides: 10 }));
      const { fruit } = generateTree(extendDefinition(fruiting, { fruit: { type, sides: 4 } }), 3);
      for (const i of fruit.indices) expect(i).toBeLessThan(fruit.positions.length / 3);
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
