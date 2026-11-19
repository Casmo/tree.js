import { RenderPipeline, type Camera, type Light, type Node, type Object3D, type Renderer, type Scene } from 'three/webgpu';
import {
  channelsFor,
  channelsKey,
  collectEffectNodes,
  liveTreeEffects,
  resolveTreeEffects,
  treeEffectsShape,
} from '../effects/effects';
import type { TreeEffectsChoice } from '../effects/effects';
import { treeEffectsPass, type TreeEffectsChannels, type TreeEffectsPass } from '../effects/pass';
import type { TreeEffectsSettings } from '../effects/suggested';
import { readTreeId, treeFromId } from '../effects/tree-id';
import type { LiveTreeEffect } from '../effects/live';
import type { StyleName } from '../styles/registry';
import type { ForestTree } from '../forest';
import type { Tree } from '../tree';
import { resolveSceneEffects, type SceneEffectsChoice, type SceneEffectsSettings } from './settings';
import { liveSceneAO } from './ao';
import { liveSceneFog } from './fog';
import { liveSceneEffects, sceneEffectsShape, type LiveSceneEffects } from './stack';

/**
 * Which Tree Effects and Scene Effects to render. `style` picks both of that Style's suggestions;
 * `treeEffects` and `sceneEffects` replace a whole group (a Style name, settings or `null` = none;
 * no deep merge: spread the suggestion to change part of it). Nothing set = nothing added.
 */
export interface ScenePipelineChoice {
  style?: StyleName;
  treeEffects?: TreeEffectsChoice;
  sceneEffects?: SceneEffectsChoice;
}

export interface ScenePipelineOptions extends ScenePipelineChoice {
  /** A shadow-casting light for god rays (never changed by the pipeline). */
  sun?: Light;
  /** The trees to outline (as `TreeEffectsOptions.selection`). Default: every tree. */
  selection?: Object3D[];
  /** Keeps the Tree ID channel on for {@link ScenePipeline.pick} (as `TreeEffectsOptions.treeId`). */
  treeId?: boolean;
  /** The trees the Highlight marks (as `TreeEffectsOptions.highlighted`). */
  highlighted?: (Tree | ForestTree)[];
}

/** The resolved settings of a Scene Pipeline (`{}` = none in a group). */
export interface ScenePipelineSettings {
  treeEffects: TreeEffectsSettings;
  sceneEffects: SceneEffectsSettings;
}

function resolveChoice(choice: ScenePipelineChoice): ScenePipelineSettings {
  const style = choice.style ?? null;
  return {
    treeEffects: resolveTreeEffects(choice.treeEffects !== undefined ? choice.treeEffects : style),
    sceneEffects: resolveSceneEffects(choice.sceneEffects !== undefined ? choice.sceneEffects : style),
  };
}

function isEmpty(settings: ScenePipelineSettings): boolean {
  return [settings.treeEffects, settings.sceneEffects].every((group) => Object.values(group).every((part) => part === undefined));
}

/** The scene pass channels the settings need (with the `treeId` option). */
function channelsOf(settings: ScenePipelineSettings, options: ScenePipelineOptions): TreeEffectsChannels {
  return channelsFor(settings.treeEffects, options);
}

/**
 * The Scene Pipeline: renders the scene with Tree Effects and Scene Effects in one `RenderPipeline`.
 * A superset of `TreeEffects` (use it instead). It never changes the renderer (tone mapping and the
 * output colour space are applied inside the pipeline). With nothing set it adds nothing: the
 * same image as `renderer.render(scene, camera)`.
 */
export class ScenePipeline {
  readonly pipeline: RenderPipeline;
  /** The trees the Highlight marks (the `highlighted` option, or an empty list): change it in place. */
  readonly highlighted: (Tree | ForestTree)[];
  private current: ScenePipelineSettings = { treeEffects: {}, sceneEffects: {} };
  private graph: {
    shape: string;
    tree: LiveTreeEffect<TreeEffectsSettings>;
    scene: LiveSceneEffects;
    treeNodes: Node[];
    /** GTAO: its pre-pass and AO node, fed into the scene pass's lighting through its context. */
    ao: ReturnType<typeof liveSceneAO> | null;
  } | null = null;
  private input!: { channels: string; pass: TreeEffectsPass };
  /** Nothing is on (no effects, no extra channel): render with `renderer.render()` itself. */
  private passThrough = true;
  /** The pipeline's fog while it is on, and the app's `scene.fogNode` it replaced (restored when off). */
  private fog: { live: ReturnType<typeof liveSceneFog>; app: Node | null | undefined } | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly options: ScenePipelineOptions = {},
  ) {
    this.pipeline = new RenderPipeline(renderer);
    this.highlighted = options.highlighted ?? [];
    this.set(options);
  }

  /** The scene pass; replaced (the old one disposed) when {@link set} needs another set of channels. */
  get scenePass(): TreeEffectsPass {
    return this.input.pass;
  }

  /** The active Tree Effects and Scene Effects. */
  get settings(): ScenePipelineSettings {
    return this.current;
  }

  /**
   * Switches Style or settings (the same rules as the options). With the same parts on, only
   * uniforms change (no recompile); otherwise a new graph is built and the old one freed.
   */
  set(choice: ScenePipelineChoice): void {
    this.current = resolveChoice(choice);
    const channels = channelsKey(channelsOf(this.current, this.options));
    if (this.input?.channels !== channels) {
      // Other channels: a new scene pass (new MRT, ADR 0009), and a new graph that reads it.
      this.disposeGraph();
      this.input?.pass.pass.dispose();
      this.input = {
        channels,
        pass: treeEffectsPass(this.scene, this.camera, this.options.selection ?? null, channelsOf(this.current, this.options)),
      };
    }
    this.passThrough = channels === '' && isEmpty(this.current);
    this.setFog();
    const { ao: aoSettings } = this.current.sceneEffects;
    const shape = JSON.stringify([
      treeEffectsShape(this.current.treeEffects, this.scenePass),
      sceneEffectsShape(this.current.sceneEffects),
      aoSettings !== undefined,
    ]);
    if (this.graph?.shape === shape) {
      this.graph.tree.update(this.current.treeEffects);
      this.graph.scene.update(this.current.sceneEffects);
      if (aoSettings) this.graph.ao?.update(aoSettings);
      return;
    }
    this.disposeGraph();
    const tree = liveTreeEffects(this.scenePass, this.current.treeEffects, this.highlighted);
    const scene = liveSceneEffects({ ...this.scenePass, color: tree.node }, this.current.sceneEffects);
    // AO only darkens ambient light: a pre-pass, GTAO, and its context on the scene pass's lighting.
    const ao = aoSettings ? liveSceneAO(this.scene, this.camera, aoSettings) : null;
    this.scenePass.pass.contextNode = ao?.context ?? null;
    this.scenePass.pass.needsUpdate = true;
    this.graph = { shape, tree, scene, treeNodes: collectEffectNodes(tree.node, this.scenePass.color), ao };
    this.pipeline.outputNode = scene.node;
    // Display colours from the stack (tone mapping): no output transform of the renderer's.
    this.pipeline.outputColorTransform = !scene.display;
    this.pipeline.needsUpdate = true;
  }

  /**
   * GPU picking, as `TreeEffects.pick()`: the Tree or Forest tree under a canvas point (CSS pixels)
   * in the last render. Needs the Tree ID channel (the `treeId: true` option).
   */
  pick(x: number, y: number): Promise<Tree | ForestTree | undefined> {
    const { pass, treeId } = this.scenePass;
    if (!treeId) throw new Error('ScenePipeline.pick() needs the Tree ID channel: create the pipeline with the `treeId: true` option');
    return readTreeId(this.renderer, pass, x, y).then(treeFromId);
  }

  /** Renders the scene (call instead of `renderer.render(scene, camera)`). */
  render(): void {
    // Nothing to add: exactly the app's own render (a pass + output transform rounds differently).
    if (this.passThrough) this.renderer.render(this.scene, this.camera);
    else this.pipeline.render();
  }

  dispose(): void {
    this.restoreFog();
    this.disposeGraph();
    this.scenePass.pass.dispose();
    this.pipeline.dispose();
  }

  /** Fog is the one scene change (ADR 0010): take over `scene.fogNode`, remembering the app's value. */
  private setFog(): void {
    const settings = this.current.sceneEffects.fog;
    if (!settings) return this.restoreFog();
    if (this.fog) return this.fog.live.update(settings, this.scene.background);
    const live = liveSceneFog(settings, this.scene.background);
    this.fog = { live, app: this.scene.fogNode };
    this.scene.fogNode = live.node;
  }

  /** Gives `scene.fogNode` back to the app (unless the app replaced the pipeline's fog meanwhile). */
  private restoreFog(): void {
    if (!this.fog) return;
    if (this.scene.fogNode === this.fog.live.node) this.scene.fogNode = this.fog.app;
    this.fog = null;
  }

  private disposeGraph(): void {
    if (!this.graph) return;
    for (const node of this.graph.treeNodes) node.dispose();
    this.graph.scene.dispose();
    if (this.graph.ao) {
      this.graph.ao.dispose();
      this.scenePass.pass.contextNode = null;
    }
    this.graph = null;
  }
}

/** Shorthand for `new ScenePipeline(renderer, scene, camera, options)`. */
export function createScenePipeline(renderer: Renderer, scene: Scene, camera: Camera, options?: ScenePipelineOptions): ScenePipeline {
  return new ScenePipeline(renderer, scene, camera, options);
}
