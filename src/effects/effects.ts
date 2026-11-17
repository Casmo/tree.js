import { RenderPipeline, type Camera, type Node, type Object3D, type Renderer, type Scene } from 'three/webgpu';
import type { StyleName } from '../styles/registry';
import { leafGlow } from './glow';
import { treeColorGrade } from './grade';
import { treeEffectsPass, type TreeEffectInput, type TreeEffectsPass } from './mask';
import { treeOutline } from './outline';
import { TREE_EFFECT_PRESETS, type TreeEffectsPreset } from './presets';

/**
 * Applies a combination of Tree Effects to `input` and returns the resulting colour node, for use in
 * your own post-processing pipeline (`pipeline.outputNode = applyTreeEffects(...)`, or feed it into
 * more effects). Order: colour grade, leaf glow, outline. An empty preset returns `input.color`.
 */
export function applyTreeEffects(input: TreeEffectInput, preset: TreeEffectsPreset): Node<'vec4'> {
  let color = input.color;
  if (preset.grade) color = treeColorGrade({ color, mask: input.mask }, preset.grade);
  if (preset.glow) color = leafGlow({ color, mask: input.mask }, preset.glow);
  if (preset.outline) color = treeOutline({ color, mask: input.mask }, preset.outline);
  return color;
}

/** The suggested combination of a built-in Style, or the preset itself; `null` = no effects. */
export type TreeEffectsChoice = StyleName | TreeEffectsPreset | null;

function resolvePreset(choice: TreeEffectsChoice): TreeEffectsPreset {
  if (choice === null) return {};
  if (typeof choice !== 'string') return choice;
  const preset = (TREE_EFFECT_PRESETS as Record<string, TreeEffectsPreset | undefined>)[choice];
  if (!preset) throw new Error(`No Tree Effects preset for Style "${choice}"`);
  return preset;
}

export interface TreeEffectsOptions {
  /** Which effects: a Style name (its suggested combination), a preset, or `null` (none). Default: none. */
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
  private current: TreeEffectsPreset = {};

  constructor(renderer: Renderer, scene: Scene, camera: Camera, options: TreeEffectsOptions = {}) {
    this.pipeline = new RenderPipeline(renderer);
    this.scenePass = treeEffectsPass(scene, camera, options.selection ?? null);
    this.set(options.effects ?? null);
  }

  /** The active combination (`{}` = none). */
  get preset(): TreeEffectsPreset {
    return this.current;
  }

  /** Switches to a Style's suggested combination, a custom preset, or none (`null`). */
  set(effects: TreeEffectsChoice): void {
    this.current = resolvePreset(effects);
    this.disposeNodes();
    const output = applyTreeEffects(this.scenePass, this.current);
    this.nodes = collectEffectNodes(output, this.scenePass.color);
    this.pipeline.outputNode = output;
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
