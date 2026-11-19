import type { StyleName } from '../styles/registry';
import type { SceneAOOptions } from './ao';
import type { SceneBloomOptions } from './bloom';
import type { SceneToneMappingOptions } from './tone-mapping';
import { SUGGESTED_SCENE_EFFECTS } from './suggested';

/**
 * A combination of Scene Effects; leave an effect out to skip it. `{}` = no Scene Effects.
 * One optional field per Scene Effect (its options type lives in the effect's own file).
 */
export interface SceneEffectsSettings {
  /** Tone mapping and the output colour space, applied inside the pipeline. */
  toneMapping?: SceneToneMappingOptions;
  /** Ground-contact ambient occlusion (GTAO) in the scene pass's lighting: darkens ambient light only. */
  ao?: SceneAOOptions;
  /** Bloom: a soft glare around the bright parts of the frame, before tone mapping. */
  bloom?: SceneBloomOptions;
}

/** The suggested Scene Effects of a built-in Style, or the settings themselves; `null` = none. */
export type SceneEffectsChoice = StyleName | SceneEffectsSettings | null;

/** The settings of a choice; throws for an unknown Style. */
export function resolveSceneEffects(choice: SceneEffectsChoice): SceneEffectsSettings {
  if (choice === null) return {};
  if (typeof choice !== 'string') return choice;
  const settings = (SUGGESTED_SCENE_EFFECTS as Record<string, SceneEffectsSettings | undefined>)[choice];
  if (!settings) throw new Error(`No suggested Scene Effects for Style "${choice}"`);
  return settings;
}
