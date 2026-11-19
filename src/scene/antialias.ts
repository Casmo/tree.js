import type { Matrix4, Node, PassNode, VelocityNode } from 'three/webgpu';
import { convertToTexture, renderOutput } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import TRAANode from 'three/addons/tsl/display/TRAANode.js';
import type { SceneEffectInput, SceneEffectStage } from './stage';
import { windVelocity } from './velocity';

/**
 * An anti-aliasing mode: SMAA (sharper, a few passes) or FXAA (one cheap pass, softer), both on
 * display colours, last in the stack; or TRAA (temporal: jittered frames blended over time, the
 * smoothest when still), on linear colours before tone mapping, with the Wind-aware velocity channel.
 */
export type SceneAntialiasMode = 'smaa' | 'fxaa' | 'traa';

/** What TRAA reads besides the colour: the scene pass's depth, its Wind-aware velocity and the camera. */
export type SceneAntialiasInput = Pick<SceneEffectInput, 'depth' | 'velocity' | 'camera'>;

/** An anti-aliasing node and the texture it samples (`textureNode`). */
type AntialiasNode = Node<'vec4'> & { textureNode: Node };

type PostMode = Exclude<SceneAntialiasMode, 'traa'>;

const NODES: Record<PostMode, (color: Node) => AntialiasNode> = {
  smaa: (color) => smaa(color) as unknown as AntialiasNode,
  fxaa: (color) => fxaa(color) as unknown as AntialiasNode,
};

function modeOf(mode: SceneAntialiasMode): SceneAntialiasMode {
  if (mode !== 'traa' && !(mode in NODES)) throw new Error(`Unknown anti-aliasing "${mode}"`);
  return mode;
}

/**
 * Scene Effect: anti-aliasing. SMAA and FXAA run on display colours: pass them the tone mapped
 * colour in the output colour space (e.g. the output of {@link sceneToneMapping}, or
 * `renderOutput(color)`), and set `pipeline.outputColorTransform = false`. TRAA runs on linear
 * colours, before tone mapping, and needs `input`: the scene pass's depth, its velocity (from
 * `windVelocityMRT()`, so swaying leaves don't ghost) and the camera (which it jitters while the
 * RenderPipeline renders).
 *
 * Side effect of `'traa'`: it sets `options.samples = 0` on the scene pass `depth` comes from (your
 * `pass(scene, camera)`), turning its MSAA off for good: TRAA copies the depth each frame, which a
 * multisampled depth cannot be (TRAA anti-aliases instead). The Scene Pipeline restores the old value
 * when TRAA goes off; with this function, set `samples` back yourself if you drop TRAA.
 */
export function sceneAntialias(color: Node<'vec4'>, mode: SceneAntialiasMode, input?: SceneAntialiasInput): Node<'vec4'> {
  return mode === 'traa' ? liveSceneTRAA(color, input ?? {}).node : liveSceneAntialias(color, mode).node;
}

function liveSceneAntialias(color: Node<'vec4'>, mode: SceneAntialiasMode) {
  // The effect samples a texture: the colour so far is rendered into one (a render target it owns).
  const node = NODES[modeOf(mode) as PostMode](color);
  return {
    node: node as Node<'vec4'>,
    dispose: () => {
      node.dispose();
      if (node.textureNode !== color) node.textureNode.dispose();
    },
  };
}

/** `TRAANode` with the (untyped) jitter methods it calls around each RenderPipeline render. */
type TRAAClass = new (...args: ConstructorParameters<typeof TRAANode>) => TRAANode & {
  setViewOffset(width: number, height: number): void;
  clearViewOffset(): void;
  readonly _originalProjectionMatrix: Matrix4;
};

/**
 * three's TRAA, which also keeps the Wind-aware velocity unjittered: TRAA gives three's own
 * `velocity` the unjittered projection while it jitters the camera; {@link windVelocity} is another
 * VelocityNode, so it gets the same (otherwise the jitter itself would read as motion).
 */
class WindTRAANode extends (TRAANode as unknown as TRAAClass) {
  override setViewOffset(width: number, height: number): void {
    super.setViewOffset(width, height);
    (windVelocity as unknown as VelocityNode).setProjectionMatrix(this._originalProjectionMatrix);
  }

  override clearViewOffset(): void {
    super.clearViewOffset();
    (windVelocity as unknown as VelocityNode).setProjectionMatrix(null);
  }
}

function liveSceneTRAA(color: Node<'vec4'>, { depth, velocity, camera }: SceneAntialiasInput) {
  const missing = Object.entries({ depth, velocity, camera }).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`TRAA ("traa" anti-aliasing) needs the scene pass's ${missing.join(', ')}: pass { depth, velocity, camera } (velocity from windVelocityMRT())`);
  }
  // TRAA keeps the previous frame's depth by copying it, which a multisampled depth cannot be: the
  // scene pass renders without MSAA while TRAA is on (TRAA anti-aliases instead); restored on dispose.
  const scenePass = (depth as { passNode?: PassNode }).passNode;
  const samples = scenePass?.options.samples;
  if (scenePass) scenePass.options.samples = 0;
  // TRAA samples a texture: the colour so far is rendered into one (a render target it owns).
  const beauty = convertToTexture(color);
  const node = new WindTRAANode(beauty, depth!, velocity!, camera!);
  return {
    node: node as unknown as Node<'vec4'>,
    dispose: () => {
      node.dispose();
      if (beauty !== color) beauty.dispose();
      if (scenePass) scenePass.options.samples = samples;
    },
  };
}

/**
 * The TRAA step of the stack, before tone mapping (as three requires), on the scene pass's depth and
 * Wind-aware velocity (the Scene Pipeline turns the velocity channel on for it).
 */
export const traaStage: SceneEffectStage = {
  shape: (settings) => (settings.antialias === 'traa' ? 'traa' : undefined),
  build(input) {
    const live = liveSceneTRAA(input.color, input);
    return { node: live.node, update: () => {}, dispose: live.dispose };
  },
  needsVelocity: true,
};

/**
 * The SMAA / FXAA step of the stack, last (after tone mapping). Without tone mapping it applies the
 * renderer's output transform itself, so it always runs on (and outputs) display colours.
 */
export const antialiasStage: SceneEffectStage = {
  shape: (settings) => {
    const mode = settings.antialias;
    return mode && mode !== 'traa' ? [modeOf(mode), !!settings.toneMapping] : undefined;
  },
  build(input, settings) {
    const display = settings.toneMapping ? input.color : (renderOutput(input.color) as unknown as Node<'vec4'>);
    const live = liveSceneAntialias(display, settings.antialias!);
    return { node: live.node, update: () => {}, dispose: live.dispose };
  },
  display: true,
};
