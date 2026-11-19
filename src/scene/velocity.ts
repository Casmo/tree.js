import { VelocityNode, type Camera, type Material, type MRTNode, type Node, type NodeBuilder, type NodeFrame, type NodeMaterial, type Object3D, type Scene, type TextureNode } from 'three/webgpu';
import { modelViewMatrix, mrt, positionLocal, uniform } from 'three/tsl';
import { treeEffectsPass, type TreeEffectsChannels, type TreeEffectsPass } from '../effects/pass';
import { windMotionOf, windTimeOf, type WindMotion } from '../wind/motion';

/**
 * Name of the velocity output in a pass's MRT (`scenePass.getTextureNode(WIND_VELOCITY)`). It is
 * `'velocity'` on purpose: three only keeps the previous frame's data (instance matrices, bones)
 * for a scene pass whose MRT has an output of that name.
 */
export const WIND_VELOCITY = 'velocity';

/**
 * The Wind time step behind a pinned Wind time (a still), and before a tree's first draw: one
 * frame at 60 fps. A pinned clock thus still shows the Wind's sway as motion, deterministically.
 */
const STILL_STEP = 1 / 60;

/** The Wind time each object was last drawn with in a velocity pass. */
const lastWindTimes = new WeakMap<Object3D, number>();

/** The Wind time a tree drawn at Wind time `now` was at in the previous frame (see {@link STILL_STEP}). */
function previousWindTime(last: number | undefined, now: number): number {
  return last === undefined || last === now ? now - STILL_STEP : last;
}

/**
 * three's `velocity` (screen-space motion since the previous frame: camera, object and instance
 * movement), plus the Wind sway of tree.js trees: for a tree material it moves each vertex back by
 * the Wind displacement between the previous frame's Wind time and now (the same Wind formula, with
 * each Forest tree's own phase). Growth and Season are not motion. Other materials get three's
 * velocity unchanged. The tree materials themselves are never changed (ADR 0011).
 */
class WindVelocityNode extends VelocityNode {
  /** The previous frame's Wind time of the tree being drawn (set per object). */
  readonly previousWindTime = uniform(0);

  override update(frame: NodeFrame): undefined {
    super.update(frame);
    const motion = motionOf(frame);
    if (!motion) return undefined;
    const now = windTimeOf(motion.source, frame.time);
    this.previousWindTime.value = previousWindTime(lastWindTimes.get(frame.object!), now);
    return undefined;
  }

  override updateAfter(frame: NodeFrame): undefined {
    super.updateAfter(frame);
    const motion = motionOf(frame);
    if (motion) lastWindTimes.set(frame.object!, windTimeOf(motion.source, frame.time));
    return undefined;
  }

  override setup(builder: NodeBuilder): Node<'vec2'> {
    const motion = windMotionOf(positionNodeOf(builder.material));
    if (!motion) return super.setup(builder) as Node<'vec2'>;
    // As three's velocity, with the previous position = this frame's one moved back by the Wind.
    const previousLocal = positionLocal.add(motion.shift(this.previousWindTime).toVarying('v_windVelocityShift'));
    const previousModelView = this.previousCameraViewMatrix.mul(this.previousModelWorldMatrix);
    const current = this.currentProjectionMatrix.mul(modelViewMatrix).mul(positionLocal);
    const previous = this.previousProjectionMatrix.mul(previousModelView).mul(previousLocal);
    return current.xy.div(current.w).sub(previous.xy.div(previous.w));
  }
}

function motionOf(frame: NodeFrame): WindMotion | undefined {
  return frame.object ? windMotionOf(positionNodeOf(frame.material)) : undefined;
}

function positionNodeOf(material: Material | null | undefined): Node | null | undefined {
  return (material as NodeMaterial | null | undefined)?.positionNode;
}

/**
 * TSL node: Wind-aware velocity (vec2, NDC units per frame), a drop-in for three's `velocity` that
 * also sees the Wind sway of tree.js trees. Use it through {@link windVelocityMRT}.
 */
export const windVelocity: Node<'vec2'> = new WindVelocityNode() as unknown as Node<'vec2'>;

/**
 * The MRT output that renders Wind-aware velocity ({@link windVelocity}) to a target named
 * `velocity` (cleared to 0), for TRAA or motion blur in your own pipeline:
 * `scenePass.setMRT(mrt({ output }).merge(windVelocityMRT()))`, then
 * `scenePass.getTextureNode(WIND_VELOCITY)`. Only a scene pass with this output pays for velocity:
 * without it, trees, their geometry and their materials render exactly as before.
 */
export function windVelocityMRT(): MRTNode {
  const node = mrt({ [WIND_VELOCITY]: windVelocity });
  node.setClearColor(WIND_VELOCITY, 0x000000, 0);
  return node;
}

/** The scene pass channels of a Scene Pipeline: the Tree Effects' ones, plus Wind-aware velocity. */
export interface ScenePassChannels extends TreeEffectsChannels {
  /** The Wind-aware velocity target ({@link windVelocityMRT}), for TRAA and motion blur. */
  velocity?: boolean;
}

/** A Scene Pipeline's scene pass: a Tree Effects pass, plus the velocity texture when asked for. */
export interface ScenePass extends TreeEffectsPass {
  /** Wind-aware velocity (NDC units per frame), with the `velocity` channel. */
  velocity?: TextureNode;
}

/** `treeEffectsPass` with the Scene Pipeline's channels (the velocity MRT merged in when asked for). */
export function createScenePass(scene: Scene, camera: Camera, selection: readonly Object3D[] | null, channels: ScenePassChannels): ScenePass {
  const { velocity, ...treeChannels } = channels;
  const input: ScenePass = treeEffectsPass(scene, camera, selection, treeChannels);
  if (velocity) {
    input.pass.setMRT(input.pass.getMRT()!.merge(windVelocityMRT()));
    input.velocity = input.pass.getTextureNode(WIND_VELOCITY);
  }
  return input;
}
