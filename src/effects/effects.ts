import { RenderPipeline, type Camera, type Material, type Mesh, type Node, type Object3D, type Renderer, type Scene } from 'three/webgpu';
import type { StyleName } from '../styles/registry';
import { leafGlow } from './glow';
import { treeColorGrade } from './grade';
import { treeEffectsPass, treePartOf, type TreeEffectInput, type TreeEffectsPass } from './mask';
import { treeOutline, type TreeOutlineTarget } from './outline';
import { TREE_EFFECT_PRESETS, type TreeEffectsPreset } from './presets';

/**
 * Applies a combination of Tree Effects to `input` and returns the resulting colour node, for use in
 * your own post-processing pipeline (`pipeline.outputNode = applyTreeEffects(...)`, or feed it into
 * more effects). Order: colour grade, leaf glow, outline. An empty preset returns `input.color`.
 * `target` is only needed for the outline.
 */
export function applyTreeEffects(input: TreeEffectInput, preset: TreeEffectsPreset, target?: TreeOutlineTarget): Node<'vec4'> {
  let color = input.color;
  if (preset.grade) color = treeColorGrade({ color, mask: input.mask }, preset.grade);
  if (preset.glow) color = leafGlow({ color, mask: input.mask }, preset.glow);
  if (preset.outline) {
    if (!target) throw new Error('applyTreeEffects: the outline needs a target {scene, camera, selectedObjects}');
    color = treeOutline({ color, mask: input.mask }, target, preset.outline);
  }
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

/** Collects every mesh in `root` drawn with a tree material. */
export function findTreeMeshes(root: Object3D, out: Object3D[] = []): Object3D[] {
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    if (!mesh.isMesh) return;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
    if (materials.some((m) => treePartOf(m) !== null)) out.push(object);
  });
  return out;
}

export interface TreeEffectsOptions {
  /** Which effects: a Style name (its suggested combination), a preset, or `null` (none). Default: none. */
  effects?: TreeEffectsChoice;
  /**
   * The trees to outline. Default: every tree mesh in the scene, looked up on each render, so
   * regenerated or added trees are picked up automatically.
   */
  trees?: Object3D[];
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
  /** The outlined trees (mutable array). */
  readonly selectedObjects: Object3D[];
  private readonly autoSelect: boolean;
  private readonly target: TreeOutlineTarget;
  private nodes: Node[] = [];
  private current: TreeEffectsPreset = {};

  constructor(renderer: Renderer, scene: Scene, camera: Camera, options: TreeEffectsOptions = {}) {
    this.pipeline = new RenderPipeline(renderer);
    this.scenePass = treeEffectsPass(scene, camera);
    this.autoSelect = options.trees === undefined;
    this.selectedObjects = options.trees ?? [];
    this.target = { scene, camera, selectedObjects: this.selectedObjects };
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
    const output = applyTreeEffects(this.scenePass, this.current, this.target);
    this.nodes = collectEffectNodes(output, this.scenePass.color);
    this.pipeline.outputNode = output;
    this.pipeline.needsUpdate = true;
  }

  /** Renders the scene with the effects (call instead of `renderer.render(scene, camera)`). */
  render(): void {
    this.refreshSelection();
    this.pipeline.render();
  }

  /** Async variant of {@link render}. */
  async renderAsync(): Promise<void> {
    this.refreshSelection();
    await this.pipeline.renderAsync();
  }

  dispose(): void {
    this.disposeNodes();
    this.scenePass.pass.dispose();
    this.pipeline.dispose();
  }

  private refreshSelection(): void {
    if (!this.autoSelect || !this.current.outline) return;
    this.selectedObjects.length = 0;
    findTreeMeshes(this.target.scene, this.selectedObjects);
  }

  private disposeNodes(): void {
    for (const node of this.nodes) node.dispose();
    this.nodes = [];
  }
}

/** The render-target owning nodes (outline, blur) in an effects graph, to dispose them on change. */
function collectEffectNodes(output: Node, stop: Node): Node[] {
  const found = new Set<Node>();
  const visit = (node: Node, seen: Set<Node>): void => {
    if (seen.has(node) || node === stop) return;
    seen.add(node);
    const n = node as Node & { isOutlineNode?: boolean; isGaussianBlurNode?: boolean };
    if (n.isOutlineNode || n.isGaussianBlurNode) found.add(node);
    for (const child of node.getChildren()) visit(child as Node, seen);
  };
  visit(output, new Set());
  return [...found];
}

/** Shorthand for `new TreeEffects(renderer, scene, camera, options)`. */
export function createTreeEffects(renderer: Renderer, scene: Scene, camera: Camera, options?: TreeEffectsOptions): TreeEffects {
  return new TreeEffects(renderer, scene, camera, options);
}
