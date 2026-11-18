import { RenderPipeline, type Camera, type Node, type Object3D, type Renderer, type Scene } from 'three/webgpu';
import type { StyleName } from '../styles/registry';
import { glowRadius, liveLeafGlow } from './glow';
import { liveTreeColorGrade } from './grade';
import type { LiveTreeEffect } from './live';
import { treeEffectsPass, type TreeEffectInput, type TreeEffectsPass } from './mask';
import { liveTreeOutline } from './outline';
import { SUGGESTED_TREE_EFFECTS, type TreeEffectsSettings } from './suggested';

/**
 * Applies a combination of Tree Effects to `input` and returns the resulting colour node, for use in
 * your own post-processing pipeline (`pipeline.outputNode = applyTreeEffects(...)`, or feed it into
 * more effects). Order: colour grade, leaf glow, outline. Empty settings return `input.color`.
 */
export function applyTreeEffects(input: TreeEffectInput, settings: TreeEffectsSettings): Node<'vec4'> {
  return liveTreeEffects(input, settings).node;
}

/**
 * The shape of a combination: what its graph is built from (the effects that are on and the glow
 * radius). Settings of the same shape only differ in uniforms.
 */
function shapeOf(settings: TreeEffectsSettings): string {
  return JSON.stringify([!!settings.grade, settings.glow ? glowRadius(settings.glow) : null, !!settings.outline]);
}

/** {@link applyTreeEffects} with every colour and number as a uniform; `update()` needs the same shape. */
function liveTreeEffects(input: TreeEffectInput, settings: TreeEffectsSettings): LiveTreeEffect<TreeEffectsSettings> {
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
  if (settings.outline) {
    const outline = liveTreeOutline({ color, mask: input.mask }, settings.outline);
    updates.push((s) => outline.update(s.outline!));
    color = outline.node;
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
}

/**
 * A ready-made post-processing pipeline (`RenderPipeline`) with the Tree Effects: render with
 * `effects.render()` instead of `renderer.render(scene, camera)`. Switch the combination with
 * `effects.set('stylized')` (e.g. a preview). For your own pipeline, use {@link treeEffectsPass}
 * and {@link applyTreeEffects} instead.
 */
export class TreeEffects {
  readonly pipeline: RenderPipeline;
  /** The scene pass (colour + tree mask). */
  readonly scenePass: TreeEffectsPass;
  private nodes: Node[] = [];
  private current: TreeEffectsSettings = {};
  private graph: { shape: string; effects: LiveTreeEffect<TreeEffectsSettings> } | null = null;

  constructor(renderer: Renderer, scene: Scene, camera: Camera, options: TreeEffectsOptions = {}) {
    this.pipeline = new RenderPipeline(renderer);
    this.scenePass = treeEffectsPass(scene, camera, options.selection ?? null);
    this.set(options.effects ?? null);
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
    const shape = shapeOf(this.current);
    if (this.graph?.shape === shape) {
      this.graph.effects.update(this.current);
      return;
    }
    this.disposeNodes();
    const live = liveTreeEffects(this.scenePass, this.current);
    this.graph = { shape, effects: live };
    this.nodes = collectEffectNodes(live.node, this.scenePass.color);
    this.pipeline.outputNode = live.node;
    this.pipeline.needsUpdate = true;
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
