import type { Node } from 'three/webgpu';
import { renderOutput } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { SceneEffectStage } from './stage';

/**
 * A post anti-aliasing mode: SMAA (sharper, a few passes) or FXAA (one cheap pass, softer). Both
 * run on display colours, last in the stack.
 */
export type SceneAntialiasMode = 'smaa' | 'fxaa';

/** An anti-aliasing node and the texture it samples (`textureNode`). */
type AntialiasNode = Node<'vec4'> & { textureNode: Node };

const NODES: Record<SceneAntialiasMode, (color: Node) => AntialiasNode> = {
  smaa: (color) => smaa(color) as unknown as AntialiasNode,
  fxaa: (color) => fxaa(color) as unknown as AntialiasNode,
};

function modeOf(mode: SceneAntialiasMode): SceneAntialiasMode {
  if (!(mode in NODES)) throw new Error(`Unknown anti-aliasing "${mode}"`);
  return mode;
}

/**
 * Scene Effect: post anti-aliasing (SMAA or FXAA) of display colours: pass it the tone mapped
 * colour in the output colour space (e.g. the output of {@link sceneToneMapping}, or
 * `renderOutput(color)`), and set `pipeline.outputColorTransform = false`.
 */
export function sceneAntialias(color: Node<'vec4'>, mode: SceneAntialiasMode): Node<'vec4'> {
  return liveSceneAntialias(color, mode).node;
}

function liveSceneAntialias(color: Node<'vec4'>, mode: SceneAntialiasMode) {
  // The effect samples a texture: the colour so far is rendered into one (a render target it owns).
  const node = NODES[modeOf(mode)](color);
  return {
    node: node as Node<'vec4'>,
    dispose: () => {
      node.dispose();
      if (node.textureNode !== color) node.textureNode.dispose();
    },
  };
}

/**
 * The SMAA / FXAA step of the stack, last (after tone mapping). Without tone mapping it applies the
 * renderer's output transform itself, so it always runs on (and outputs) display colours.
 */
export const antialiasStage: SceneEffectStage = {
  shape: (settings) => {
    const mode = settings.antialias;
    return mode ? [modeOf(mode), !!settings.toneMapping] : undefined;
  },
  build(input, settings) {
    const display = settings.toneMapping ? input.color : (renderOutput(input.color) as unknown as Node<'vec4'>);
    const live = liveSceneAntialias(display, settings.antialias!);
    return { node: live.node, update: () => {}, dispose: live.dispose };
  },
  display: true,
};
