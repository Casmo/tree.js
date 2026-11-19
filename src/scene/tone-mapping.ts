import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  type Node,
  type ToneMapping,
} from 'three/webgpu';
import { renderOutput, toneMapping, uniform } from 'three/tsl';
import type { SceneEffectStage } from './stage';

/** A tone mapping curve: AgX and Neutral keep foliage green; ACES shifts greens towards yellow. */
export type SceneToneMappingCurve = 'agx' | 'neutral' | 'aces' | 'reinhard' | 'cineon' | 'linear';

/** Tone mapping settings (all optional). */
export interface SceneToneMappingOptions {
  /** The curve (default 'agx'). Changing it builds a new graph. */
  mapping?: SceneToneMappingCurve;
  /** Exposure before the curve (default 1); a uniform. */
  exposure?: number;
}

const CURVES: Record<SceneToneMappingCurve, ToneMapping> = {
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  aces: ACESFilmicToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
  linear: LinearToneMapping,
};

function curveOf(options: SceneToneMappingOptions): SceneToneMappingCurve {
  const mapping = options.mapping ?? 'agx';
  if (!(mapping in CURVES)) throw new Error(`Unknown tone mapping "${mapping}"`);
  return mapping;
}

/**
 * Scene Effect: tone mapping plus the conversion to the renderer's output colour space, inside the
 * pipeline (the renderer's `toneMapping` is not used or changed). Returns display colours: in your
 * own `RenderPipeline`, set `pipeline.outputColorTransform = false` (as for three's `renderOutput`).
 */
export function sceneToneMapping(color: Node<'vec4'>, options: SceneToneMappingOptions = {}): Node<'vec4'> {
  return liveSceneToneMapping(color, options).node;
}

function liveSceneToneMapping(color: Node<'vec4'>, options: SceneToneMappingOptions) {
  const exposure = uniform(1);
  const update = (o: SceneToneMappingOptions): void => {
    exposure.value = o.exposure ?? 1;
  };
  update(options);
  // Our own curve with a uniform exposure, then renderOutput with no further tone mapping: only the
  // output colour space (the renderer's, through the pipeline's context).
  const mapped = toneMapping(CURVES[curveOf(options)], exposure, color) as unknown as Node<'vec4'>;
  return { node: renderOutput(mapped, NoToneMapping, null) as unknown as Node<'vec4'>, update };
}

/** The tone mapping step of the stack. */
export const toneMappingStage: SceneEffectStage = {
  shape: (settings) => (settings.toneMapping ? curveOf(settings.toneMapping) : undefined),
  build(input, settings) {
    const live = liveSceneToneMapping(input.color, settings.toneMapping!);
    return { node: live.node, update: (s) => live.update(s.toneMapping!) };
  },
  display: true,
};
