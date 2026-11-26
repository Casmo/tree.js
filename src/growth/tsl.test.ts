import { describe, expect, it } from 'vitest';
import { float, positionGeometry } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { parseDefinition } from '../definition';
import { generateTree, type GeometryBuffers } from '../generator';
import { birch, oak } from '../species';
import painterly from '../styles/painterly';
import realistic from '../styles/realistic';
import { growPositions, growthPosition } from './index';

// The TSL Growth graph evaluated on the CPU, vertex by vertex: a small interpreter for the nodes the
// graph is made of (constants, attributes, swizzles, operators, math), so the shader's model can be
// compared number for number with `growPositions`. The graph is built for a geometry (`builder.geometry`).

type Value = number[];
type AnyNode = Record<string, unknown> & { getAttributeName?: (builder: unknown) => string };

function evaluate(node: AnyNode, vertex: (name: string) => Value, builder: object): Value {
  const ev = (n: unknown) => evaluate(n as AnyNode, vertex, builder);
  const zip = (a: Value, b: Value, f: (x: number, y: number) => number) => {
    const n = Math.max(a.length, b.length);
    return Array.from({ length: n }, (_, i) => f(a[a.length === 1 ? 0 : i]!, b[b.length === 1 ? 0 : i]!));
  };
  if (node.isShaderCallNodeInternal) {
    const shader = node.shaderNode as { jsFunc: (...args: unknown[]) => unknown };
    return ev(shader.jsFunc.length > 1 ? shader.jsFunc([], builder) : shader.jsFunc(builder));
  }
  const type = (node.constructor as { type?: string }).type ?? (node.constructor as { name: string }).name;
  if (node.isConstNode) {
    const value = node.value as number | { toArray(): number[] };
    return typeof value === 'number' ? [value] : value.toArray();
  }
  if (type === 'AttributeNode') return vertex(node.getAttributeName!(builder));
  if (node.isVaryingNode || type === 'ConvertNode') return ev(node.node);
  if (node.isSplitNode) {
    const value = ev(node.node);
    return [...(node.components as string)].map((c) => value['xyzw'.indexOf(c)]!);
  }
  if (node.isOperatorNode) {
    const [a, b] = [ev(node.aNode), ev(node.bNode)];
    const ops: Record<string, (x: number, y: number) => number> = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y };
    return zip(a, b, ops[node.op as string]!);
  }
  if (node.isMathNode) {
    const a = ev(node.aNode);
    const b = node.bNode ? ev(node.bNode) : [];
    const c = node.cNode ? ev(node.cNode) : [];
    switch (node.method) {
      case 'max':
        return zip(a, b, Math.max);
      case 'min':
        return zip(a, b, Math.min);
      case 'clamp':
        return zip(zip(a, b, Math.max), c, Math.min);
      case 'negate':
        return a.map((x) => -x);
    }
  }
  if (node.isStackNode || node.isVarNode || node.isContextNode) return ev(node.outputNode ?? node.node);
  throw new Error(`cannot evaluate ${type}`);
}

/** Vertex positions the TSL Growth graph gives `buffers` at Growth `g`. */
function tslPositions(buffers: GeometryBuffers, g: number, vertices: number[]): number[][] {
  const node = growthPosition(float(g) as unknown as Node<'float'>, positionGeometry) as unknown as AnyNode;
  const builder = { geometry: { hasAttribute: (name: string) => name in buffers.attributes, getAttribute: (name: string) => buffers.attributes[name] } };
  return vertices.map((v) => {
    const vertex = (name: string): Value => {
      if (name === 'position') return [...buffers.positions.subarray(v * 3, v * 3 + 3)];
      if (name === 'normal') return [...buffers.normals.subarray(v * 3, v * 3 + 3)];
      const attribute = buffers.attributes[name];
      if (!attribute) throw new Error(`the graph reads ${name}, which the geometry lacks`);
      return [...attribute.array.subarray(v * attribute.itemSize, (v + 1) * attribute.itemSize)];
    };
    return evaluate(node, vertex, builder);
  });
}

describe('growthPosition (TSL) matches growPositions (CPU)', () => {
  const cases = [
    ['realistic oak', generateTree(parseDefinition(realistic.apply(oak)), 3)],
    ['painterly birch (Leaf Masses)', generateTree(parseDefinition(painterly.apply(birch)), 3)],
  ] as const;
  for (const [name, data] of cases) {
    for (const part of ['wood', 'leaves'] as const) {
      it(`${name}: ${part}`, () => {
        const buffers = data[part];
        const count = buffers.positions.length / 3;
        const vertices = Array.from({ length: 200 }, (_, i) => Math.floor((i * count) / 200));
        for (const g of [0, 0.15, 0.35, 0.5, 0.7, 0.9, 1]) {
          const cpu = growPositions(buffers, g);
          const tsl = tslPositions(buffers, g, vertices);
          vertices.forEach((v, i) => {
            for (let k = 0; k < 3; k++) expect(tsl[i]![k]!).toBeCloseTo(cpu[v * 3 + k]!, 5);
          });
        }
      });
    }
  }
});
