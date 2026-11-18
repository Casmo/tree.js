// Screen-space helpers shared by the Tree Effects (internal, not exported from the package).
import type { Camera, Node, NodeBuilder, TextureNode } from 'three/webgpu';
import { Fn, ivec2, logarithmicDepthToViewZ, orthographicDepthToViewZ, perspectiveDepthToViewZ, screenCoordinate, textureSize, uint, uniform, vec2 } from 'three/tsl';

const DIAGONAL = Math.SQRT1_2;
/** Eight sample directions around a pixel, unit length: the four axes and the four diagonals. */
export const EIGHT_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [DIAGONAL, DIAGONAL], [DIAGONAL, -DIAGONAL], [-DIAGONAL, DIAGONAL], [-DIAGONAL, -DIAGONAL],
];
/** Four sample directions around a pixel: the axes. */
export const FOUR_DIRECTIONS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The size of a texture in pixels, as a `vec2`. */
export function sizeOf(texture: TextureNode): Node<'vec2'> {
  return vec2(textureSize(texture) as unknown as Node<'ivec2'>);
}

/**
 * The texel `offset` px from the pixel being shaded, clamped to the texture, for exact texel loads
 * (`texture.load(texelAt(texture, offset))`) of unfiltered targets such as the Tree ID.
 */
export function texelAt(texture: TextureNode, offset: Node<'vec2'>): Node<'ivec2'> {
  return ivec2(screenCoordinate.xy.add(offset).floor().clamp(vec2(0), sizeOf(texture).sub(1)));
}

/** The Tree ID at a texel (see {@link texelAt}): 0 where no tree is drawn. */
export function treeIdAt(treeId: TextureNode, texel: Node<'ivec2'>): Node<'uint'> {
  return uint(treeId.load(texel).x);
}

/** An optional input an effect needs, or an error naming the effect, the input and where to get it. */
export function requireInput<T>(effect: string, value: T | undefined, name: string, hint: string): T {
  if (value === undefined) throw new Error(`${effect} needs the \`${name}\` input: ${hint}`);
  return value;
}

/**
 * Whether the scene depth `depth` is further from the camera than `than` (both raw values of the
 * scene pass's depth texture). Decided per renderer when the shader is built: a reversed depth
 * buffer (`reversedDepthBuffer`) stores 1 at the near plane and 0 at the far plane, a standard or
 * logarithmic one the other way around.
 */
export const isFurther = Fn(([depth, than]: [Node<'float'>, Node<'float'>], builder: NodeBuilder) =>
  builder.renderer.reversedDepthBuffer === true ? depth.lessThan(than) : depth.greaterThan(than),
) as unknown as (depth: Node<'float'>, than: Node<'float'>) => Node<'bool'>;

/**
 * A function turning a raw value of the scene pass's depth texture into view Z (negative, in world
 * units) for `camera` (its near and far are read every render). It follows the renderer's depth
 * buffer: standard, reversed (`reversedDepthBuffer`) or logarithmic (`logarithmicDepthBuffer`,
 * which three only applies to perspective cameras).
 */
export function viewZFromDepth(camera: Camera): (depth: Node<'float'>) => Node<'float'> {
  const lens = camera as Camera & { near: number; far: number; isOrthographicCamera?: boolean };
  const near = uniform(0).onRenderUpdate((_, node) => {
    node.value = lens.near;
    return undefined;
  });
  const far = uniform(0).onRenderUpdate((_, node) => {
    node.value = lens.far;
    return undefined;
  });
  const orthographic = lens.isOrthographicCamera === true;
  // orthographicDepthToViewZ and perspectiveDepthToViewZ handle the reversed depth buffer themselves.
  const convert = Fn(([depth]: [Node<'float'>], builder: NodeBuilder) => {
    if (orthographic) return orthographicDepthToViewZ(depth, near, far);
    if (builder.renderer.logarithmicDepthBuffer === true) return logarithmicDepthToViewZ(depth, near, far);
    return perspectiveDepthToViewZ(depth, near, far);
  });
  return (depth) => convert(depth) as unknown as Node<'float'>;
}
