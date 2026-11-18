import { RenderPipeline, type Camera, type Node, type Object3D, type Renderer, type Scene } from 'three/webgpu';
import type { StyleName } from '../styles/registry';
import { glowRadius, liveLeafGlow } from './glow';
import { liveTreeColorGrade } from './grade';
import type { LiveTreeEffect } from './live';
import type { TreeEffectInput } from './mask';
import { liveTreeHighlight } from './highlight';
import { liveTreeOutline } from './outline';
import { liveInnerLines } from './inner-lines';
import { treeEffectsPass, type TreeEffectsChannels, type TreeEffectsPass } from './pass';
import { SUGGESTED_TREE_EFFECTS, type TreeEffectsSettings } from './suggested';
import { readTreeId, treeFromId } from './tree-id';
import type { ForestTree } from '../forest';
import type { Tree } from '../tree';

/**
 * Applies a combination of Tree Effects to `input` and returns the resulting colour node, for use in
 * your own post-processing pipeline (`pipeline.outputNode = applyTreeEffects(...)`, or feed it into
 * more effects). Order: colour grade, leaf glow, inner lines, outline, highlight (always on top).
 * Empty settings return `input.color`. `highlighted`: the trees the Highlight marks (mutable, read every frame).
 */
export function applyTreeEffects(input: TreeEffectInput, settings: TreeEffectsSettings, highlighted: readonly (Tree | ForestTree)[] = []): Node<'vec4'> {
  return liveTreeEffects(input, settings, highlighted).node;
}

/**
 * The shape of a combination: what its graph is built from (the effects that are on, the glow
 * radius, the outline's `betweenTrees` and the normal encoding of Inner Lines). Settings of the same
 * shape only differ in uniforms.
 */
function shapeOf(settings: TreeEffectsSettings, input: TreeEffectInput): string {
  const outline = settings.outline ? (settings.outline.betweenTrees === true ? 'between' : 'outline') : null;
  const innerLines = settings.innerLines ? (input.normalEncoding ?? 'color') : null;
  return JSON.stringify([!!settings.grade, settings.glow ? glowRadius(settings.glow) : null, outline, innerLines, !!settings.highlight]);
}

/** {@link applyTreeEffects} with every colour and number as a uniform; `update()` needs the same shape. */
function liveTreeEffects(
  input: TreeEffectInput,
  settings: TreeEffectsSettings,
  highlighted: readonly (Tree | ForestTree)[],
): LiveTreeEffect<TreeEffectsSettings> {
  const updates: ((settings: TreeEffectsSettings) => void)[] = [];
  let color = input.color;
  if (settings.grade) {
    const grade = liveTreeColorGrade({ color, mask: input.mask }, settings.grade);
    updates.push((s) => grade.update(s.grade!));
    color = grade.node;
  }
  if (settings.glow) {
    const glow = liveLeafGlow({ color, mask: input.mask }, settings.glow);
    updates.push((s) => glow.update(s.glow!));
    color = glow.node;
  }
  if (settings.innerLines) {
    const lines = liveInnerLines({ ...input, color }, settings.innerLines);
    updates.push((s) => lines.update(s.innerLines!));
    color = lines.node;
  }
  if (settings.outline) {
    const outline = liveTreeOutline({ ...input, color }, settings.outline);
    updates.push((s) => outline.update(s.outline!));
    color = outline.node;
  }
  // Highlight last, so it always sits on top.
  if (settings.highlight) {
    const highlight = liveTreeHighlight({ ...input, color }, highlighted, settings.highlight);
    updates.push((s) => highlight.update(s.highlight!));
    color = highlight.node;
  }
  return { node: color, update: (s) => updates.forEach((update) => update(s)) };
}

/** The suggested combination of a built-in Style, or the settings themselves; `null` = no effects. */
export type TreeEffectsChoice = StyleName | TreeEffectsSettings | null;

function resolveEffects(choice: TreeEffectsChoice): TreeEffectsSettings {
  if (choice === null) return {};
  if (typeof choice !== 'string') return choice;
  const settings = (SUGGESTED_TREE_EFFECTS as Record<string, TreeEffectsSettings | undefined>)[choice];
  if (!settings) throw new Error(`No suggested Tree Effects for Style "${choice}"`);
  return settings;
}

export interface TreeEffectsOptions {
  /** Which effects: a Style name (its suggested combination), custom settings, or `null` (none). Default: none. */
  effects?: TreeEffectsChoice;
  /**
   * The trees to outline (Trees, Forests, groups of them; mutable, read on every draw).
   * Default: every tree in the scene.
   */
  selection?: Object3D[];
  /**
   * Keeps the Tree ID channel on even when no effect needs it, for {@link TreeEffects.pick}.
   * Default: false (the channel is only rendered when an effect needs it).
   */
  treeId?: boolean;
  /**
   * The trees the Highlight marks (`effects: { highlight: {...} }`): Trees and Forest trees, at most
   * 64; mutable, read every frame, so hover and selection changes never recompile. Default: none
   * (a new empty list, see {@link TreeEffects.highlighted}).
   */
  highlighted?: (Tree | ForestTree)[];
}

/**
 * The extra channels the scene pass needs for `settings` (with the `treeId` option). Only this
 * set decides the scene pass's MRT: settings that need the same channels keep it.
 */
function channelsFor(settings: TreeEffectsSettings, options: TreeEffectsOptions): TreeEffectsChannels {
  return {
    treeId: options.treeId === true || settings.outline?.betweenTrees === true || !!settings.highlight,
    normal: !!settings.innerLines,
  };
}

/** A key that is equal for equal sets of channels. */
function channelsKey(channels: TreeEffectsChannels): string {
  return Object.entries(channels)
    .filter(([, on]) => on === true)
    .map(([name]) => name)
    .sort()
    .join();
}

/**
 * A ready-made post-processing pipeline (`RenderPipeline`) with the Tree Effects: render with
 * `effects.render()` instead of `renderer.render(scene, camera)`. Switch the combination with
 * `effects.set('stylized')` (e.g. a preview). For your own pipeline, use {@link treeEffectsPass}
 * and {@link applyTreeEffects} instead.
 */
export class TreeEffects {
  readonly pipeline: RenderPipeline;
  /** The trees the Highlight marks (the `highlighted` option, or an empty list): change it in place. */
  readonly highlighted: (Tree | ForestTree)[];
  private nodes: Node[] = [];
  private current: TreeEffectsSettings = {};
  private graph: { shape: string; effects: LiveTreeEffect<TreeEffectsSettings> } | null = null;
  private input!: { channels: string; pass: TreeEffectsPass };

  constructor(
    private readonly renderer: Renderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly options: TreeEffectsOptions = {},
  ) {
    this.pipeline = new RenderPipeline(renderer);
    this.highlighted = options.highlighted ?? [];
    this.set(options.effects ?? null);
  }

  /**
   * The scene pass (colour + tree mask, plus the channels the settings need, such as the Tree ID).
   * It is only replaced when {@link set} needs other channels.
   */
  get scenePass(): TreeEffectsPass {
    return this.input.pass;
  }

  /** The active combination (`{}` = none). */
  get settings(): TreeEffectsSettings {
    return this.current;
  }

  /**
   * Switches to a Style's suggested combination, custom settings, or none (`null`). With the same
   * effects on (and the same glow radius) only the colours and numbers change, without a recompile;
   * otherwise a new graph is built and the old one freed.
   */
  set(effects: TreeEffectsChoice): void {
    this.current = resolveEffects(effects);
    const channels = channelsFor(this.current, this.options);
    const key = channelsKey(channels);
    if (this.input?.channels !== key) {
      // Other channels: a new scene pass (new MRT), and a new graph that reads it.
      this.disposeNodes();
      this.input?.pass.pass.dispose();
      this.input = { channels: key, pass: treeEffectsPass(this.scene, this.camera, this.options.selection ?? null, channels) };
      this.graph = null;
    }
    const shape = shapeOf(this.current, this.scenePass);
    if (this.graph?.shape === shape) {
      this.graph.effects.update(this.current);
      return;
    }
    this.disposeNodes();
    const live = liveTreeEffects(this.scenePass, this.current, this.highlighted);
    this.graph = { shape, effects: live };
    this.nodes = collectEffectNodes(live.node, this.scenePass.color);
    this.pipeline.outputNode = live.node;
    this.pipeline.needsUpdate = true;
  }

  /**
   * GPU picking: the Tree or Forest tree under a point of the canvas (CSS pixels from its top left
   * corner, as `event.offsetX/offsetY`) in the last render, or `undefined` where no tree is drawn.
   * Needs the Tree ID channel: throws when it is off (create the effects with `treeId: true`).
   */
  pick(x: number, y: number): Promise<Tree | ForestTree | undefined> {
    const { pass, treeId } = this.scenePass;
    if (!treeId) throw new Error('TreeEffects.pick() needs the Tree ID channel: create the effects with the `treeId: true` option');
    return readTreeId(this.renderer, pass, x, y).then(treeFromId);
  }

  /** Renders the scene with the effects (call instead of `renderer.render(scene, camera)`). */
  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.disposeNodes();
    this.scenePass.pass.dispose();
    this.pipeline.dispose();
  }

  private disposeNodes(): void {
    for (const node of this.nodes) node.dispose();
    this.nodes = [];
  }
}

/** The render-target owning nodes (blur) in an effects graph, to dispose them on change. */
function collectEffectNodes(output: Node, stop: Node): Node[] {
  const found = new Set<Node>();
  const visit = (node: Node, seen: Set<Node>): void => {
    if (seen.has(node) || node === stop) return;
    seen.add(node);
    const n = node as Node & { isGaussianBlurNode?: boolean };
    if (n.isGaussianBlurNode) found.add(node);
    for (const child of node.getChildren()) visit(child as Node, seen);
  };
  visit(output, new Set());
  return [...found];
}

/** Shorthand for `new TreeEffects(renderer, scene, camera, options)`. */
export function createTreeEffects(renderer: Renderer, scene: Scene, camera: Camera, options?: TreeEffectsOptions): TreeEffects {
  return new TreeEffects(renderer, scene, camera, options);
}
