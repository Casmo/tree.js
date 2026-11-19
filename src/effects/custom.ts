import type { Node } from 'three/webgpu';
import type { LiveTreeEffect } from './live';
import type { TreeEffectInput } from './mask';
import type { TreeEffectsChannels } from './pass';
import type { TreeEffectsSettings } from './suggested';

/** A built-in Tree Effect, by its key in {@link TreeEffectsSettings}. */
export type TreeEffectName = keyof TreeEffectsSettings;

/** The order the built-in Tree Effects run in (the Highlight always last, on top). */
export const TREE_EFFECT_ORDER: readonly TreeEffectName[] = ['grade', 'glow', 'innerLines', 'outline', 'highlight'];

/**
 * A Tree Effect written by the app, for `TreeEffects.addEffect()`. It is built the way the built-in
 * ones are: on the colour so far and the tree mask, returning its colour node and an `update()`
 * that changes its uniforms live (no new graph, no recompile).
 */
export interface CustomTreeEffect<Options = undefined> {
  /**
   * Runs right before this built-in Tree Effect, whether that one is on or not; custom effects at the
   * same place run in the order they were added. Default `'highlight'`: after every other built-in
   * effect, and under the Highlight.
   */
  before?: TreeEffectName;
  /**
   * The optional channels the effect reads (`treeId`, `normal`): the scene pass adds them (ADR 0009)
   * and they are in the effect's input. Undeclared channels are never in its input, even when a
   * built-in effect has them on. Default: none (colour, tree mask, depth and camera only).
   */
  channels?: TreeEffectsChannels;
  /**
   * Builds the effect. `input.color` is the colour so far (the scene colour, or the result of the
   * effects before this one); `input.mask` is the tree mask: r = any tree, g = leaves only,
   * b = selected trees. Called again with the latest options whenever the graph is rebuilt.
   */
  build(input: TreeEffectInput, options: Options): LiveTreeEffect<Options>;
}

/** The options argument of `addEffect`: optional when the effect's options may be `undefined`. */
export type CustomTreeEffectOptions<Options> = undefined extends Options ? [options?: Options] : [options: Options];

interface Entry {
  effect: CustomTreeEffect<unknown>;
  options: unknown;
  id: number;
  live: LiveTreeEffect<unknown> | null;
}

let nextId = 1;

/**
 * Internal: the custom Tree Effects of a pipeline (`TreeEffects`, the Scene Pipeline) with their
 * latest options. It decides their part of the graph's shape and of the scene pass's channels, and
 * builds them into a graph at their places.
 */
export class CustomTreeEffectList {
  private entries: Entry[] = [];

  /** The custom effects, in the order they were added. */
  get effects(): readonly CustomTreeEffect<never>[] {
    return this.entries.map((entry) => entry.effect as CustomTreeEffect<never>);
  }

  add<Options>(effect: CustomTreeEffect<Options>, options: Options): void {
    if (this.find(effect)) throw new Error('This custom Tree Effect is already added; use updateEffect() to change its options');
    this.entries.push({ effect: effect as CustomTreeEffect<unknown>, options, id: nextId++, live: null });
  }

  /** Stores the options (used on rebuilds) and sets them on the built effect. */
  update<Options>(effect: CustomTreeEffect<Options>, options: Options): void {
    const entry = this.find(effect);
    if (!entry) throw new Error('This custom Tree Effect is not added; add it with addEffect() first');
    entry.options = options;
    entry.live?.update(options);
  }

  /** Whether the effect was there. */
  remove(effect: CustomTreeEffect<never>): boolean {
    const entry = this.find(effect);
    if (entry) this.entries.splice(this.entries.indexOf(entry), 1);
    return !!entry;
  }

  /** The channels the custom effects declare. */
  channels(): TreeEffectsChannels {
    return {
      treeId: this.entries.some((entry) => entry.effect.channels?.treeId === true),
      normal: this.entries.some((entry) => entry.effect.channels?.normal === true),
    };
  }

  /** Their part of a graph's shape: which effects, in which order and at which places. */
  shape(): string {
    return this.entries.map((entry) => `${entry.id}@${placeOf(entry.effect)}`).join();
  }

  /** Builds the custom effects placed before `name` onto `input.color` and returns the resulting colour. */
  buildBefore(name: TreeEffectName, input: TreeEffectInput): Node<'vec4'> {
    let color = input.color;
    for (const entry of this.entries) {
      if (placeOf(entry.effect) !== name) continue;
      entry.live = entry.effect.build(inputFor(entry.effect, { ...input, color }), entry.options);
      color = entry.live.node;
    }
    return color;
  }

  private find(effect: CustomTreeEffect<never>): Entry | undefined {
    return this.entries.find((entry) => entry.effect === effect);
  }
}

function placeOf(effect: CustomTreeEffect<never>): TreeEffectName {
  return effect.before ?? 'highlight';
}

/** The input an effect may read: colour, mask, depth and camera, and only the channels it declares. */
function inputFor(effect: CustomTreeEffect<never>, input: TreeEffectInput): TreeEffectInput {
  const { treeId, normal, normalEncoding, ...always } = input;
  return {
    ...always,
    ...(effect.channels?.treeId && treeId && { treeId }),
    ...(effect.channels?.normal && normal && { normal, normalEncoding }),
  };
}
