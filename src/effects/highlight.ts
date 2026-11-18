import { Color, type ColorRepresentation, type Node, type TextureNode } from 'three/webgpu';
import { Break, float, Fn, If, ivec2, Loop, max, mix, screenCoordinate, select, textureSize, time, uint, uniform, uniformArray, vec2, vec4 } from 'three/tsl';
import type { ForestTree } from '../forest';
import type { Tree } from '../tree';
import type { LiveTreeEffect } from './live';
import type { TreeEffectInput } from './mask';
import { treeIdOf } from './tree-id';

/** Highlight settings. */
export interface TreeHighlightOptions {
  /** Colour the highlighted trees are tinted towards (default a warm yellow, '#ffe066'). */
  color?: ColorRepresentation;
  /** How far the trees are tinted towards `color`, 0..1 (default 0.25). */
  tint?: number;
  /** Brightness multiplier of the highlighted trees (default 1.25). */
  brightness?: number;
  /** Colour of the ring just outside the highlighted trees (default '#ffd23f'). */
  outlineColor?: ColorRepresentation;
  /** Width of the ring in pixels (default 2). */
  thickness?: number;
  /** Opacity of the whole Highlight, 0..1 (default 1). */
  strength?: number;
  /**
   * Pulse frequency in Hz: tint and brightness swing between their value and half of it (half the
   * brightening); the ring stays solid. Default 0 = no pulse.
   */
  pulse?: number;
}

/** The most trees highlighted at once; the rest of the list is ignored (with one console warning). */
const MAX_HIGHLIGHTED = 64;

// Eight sample directions around a pixel (unit length), as the outline.
const D = Math.SQRT1_2;
const DIRECTIONS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [D, D], [D, -D], [-D, D], [-D, -D]];

/**
 * The current Tree ID of a highlighted entry, or `undefined` to skip it: a removed or undrawn
 * Forest tree, a Tree that is disposed or in no scene, or anything that is not a Tree or Forest tree.
 */
function idOfHighlighted(entry: Tree | ForestTree): number | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  if ('isTree' in entry) return entry.isTree && entry.parent !== null ? treeIdOf(entry) : undefined;
  if (!('slot' in entry) || !('owner' in entry)) return undefined;
  return treeIdOf(entry);
}

/**
 * Tree Effect: marks the trees in `highlighted` (Trees and Forest trees; mutable, read every frame)
 * by brightening and tinting their pixels and drawing a ring just outside them, the one Tree Effect
 * that also changes pixels next to a tree. At most 64 trees (the rest is ignored with one warning); removed, disposed
 * and undrawn trees are skipped. Needs the Tree ID input (`treeEffectsPass` with `{ treeId: true }`).
 */
export function treeHighlight(input: TreeEffectInput, highlighted: readonly (Tree | ForestTree)[], options: TreeHighlightOptions = {}): Node<'vec4'> {
  return liveTreeHighlight(input, highlighted, options).node;
}

/** {@link treeHighlight} with its settings as uniforms. */
export function liveTreeHighlight(
  input: TreeEffectInput,
  highlighted: readonly (Tree | ForestTree)[],
  options: TreeHighlightOptions = {},
): LiveTreeEffect<TreeHighlightOptions> {
  const treeId = input.treeId;
  if (!treeId) throw new Error('Highlight needs the Tree ID input: use treeEffectsPass(..., { treeId: true }) or merge treeIdMRT() and pass `treeId`');

  const color = uniform(new Color());
  const outlineColor = uniform(new Color());
  const tint = uniform(0);
  const brightness = uniform(0);
  const thickness = uniform(0);
  const strength = uniform(0);
  const pulse = uniform(0);
  const update = (o: TreeHighlightOptions): void => {
    color.value.set(o.color ?? '#ffe066');
    outlineColor.value.set(o.outlineColor ?? '#ffd23f');
    tint.value = o.tint ?? 0.25;
    brightness.value = o.brightness ?? 1.25;
    thickness.value = o.thickness ?? 2;
    strength.value = o.strength ?? 1;
    pulse.value = o.pulse ?? 0;
  };
  update(options);

  // The IDs of the highlighted trees, refreshed once before every render (by whichever of the two
  // uniforms is updated first; the array is copied to its buffer after its own refresh).
  const count = uniform(0, 'uint');
  const ids = uniformArray(new Array<number>(MAX_HIGHLIGHTED).fill(0), 'uint');
  let refreshed = -1;
  let warned = false;
  const refresh = (renderId: number): void => {
    if (renderId === refreshed) return;
    refreshed = renderId;
    let n = 0;
    for (const entry of highlighted) {
      const id = idOfHighlighted(entry);
      if (id === undefined) continue;
      if (n === MAX_HIGHLIGHTED) {
        if (!warned) console.warn(`Highlight: at most ${MAX_HIGHLIGHTED} trees are highlighted at once; the rest are ignored`);
        warned = true;
        break;
      }
      ids.array[n++] = id;
    }
    ids.array.fill(0, n);
    count.value = n;
  };
  count.onRenderUpdate((frame) => {
    refresh(frame.renderId);
    return undefined;
  });
  ids.onRenderUpdate((frame) => refresh(frame.renderId));

  const last = vec2(textureSize(treeId) as unknown as Node<'ivec2'>).sub(1);
  /** 1 where the tree drawn at `offset` px from this pixel is highlighted, else 0. */
  const isHighlighted = Fn(([offset]: [Node<'vec2'>]) => {
    const at = ivec2(screenCoordinate.xy.add(offset).floor().clamp(vec2(0), last));
    const id = uint((treeId as TextureNode).load(at).x);
    const hit = float(0).toVar();
    If(id.notEqual(uint(0)), () => {
      Loop({ start: uint(0), end: count, type: 'uint', condition: '<' }, ({ i }) => {
        If((ids.element(i) as unknown as Node<'uint'>).equal(id), () => {
          hit.assign(1);
          Break();
        });
      });
    });
    return hit;
  });

  const self = isHighlighted(vec2(0));
  let near: Node<'float'> = float(0);
  for (const [x, y] of DIRECTIONS) near = max(near, isHighlighted(vec2(x, y).mul(thickness).round()));
  const ring = near.mul(float(1).sub(self));

  // 1 without a pulse, else swinging between 1 and 0.5 with a sine.
  const swing = float(0.75).add(float(0.25).mul(time.mul(pulse).mul(2 * Math.PI).cos()));
  const lifted = input.color.rgb.mul(float(1).add(brightness.sub(1).mul(swing)));
  const marked = mix(lifted, color, tint.mul(swing).clamp(0, 1));
  const rgb = mix(input.color.rgb, marked, self.mul(strength));
  const node = vec4(mix(rgb, outlineColor, ring.mul(strength)), input.color.a);
  // Nothing highlighted: the colour as it is.
  return { node: select(count.equal(uint(0)), input.color, node), update };
}
