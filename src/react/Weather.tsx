import { use, useImperativeHandle, useLayoutEffect, useMemo, type Ref } from 'react';
// Types only: the weather module is loaded with a dynamic import the first time a <SnowCover> or
// <Wetness> renders, so apps that never use weather don't bundle it (ADR 0012).
import type {
  Snow,
  SnowCoverHooks,
  SnowCoverSettings,
  Wetness as WetnessAmount,
  WetnessHooks,
  WetnessSettings,
} from '../weather';
import type { TreeShaderHooks } from '../materials/shader-hooks';
import { useSceneShaderHooks } from './SceneShaderHooks';

type WeatherModule = typeof import('../weather');

let weatherModule: Promise<WeatherModule> | undefined;

/** The `@casmo/tree.js/weather` module, loaded once (a failed load is retried on the next render). */
function weatherResource(): Promise<WeatherModule> {
  if (!weatherModule) {
    weatherModule = import('../weather');
    weatherModule.catch(() => (weatherModule = undefined));
  }
  return weatherModule;
}

/** Starts loading the weather module (Snow Cover, Wetness) ahead of time, without suspending. */
export function preloadWeather(): void {
  void weatherResource().catch(() => {});
}

/** Something with a 0..1 amount (a `Snow` or a `Wetness`). */
interface Amount {
  amount: number;
}

/** Writes `amount` (when given) to `source`, and puts back the amount it found on unmount. */
function useAmount(source: Amount, amount: number | undefined): void {
  useLayoutEffect(() => {
    const previous = source.amount;
    return () => {
      source.amount = previous;
    };
  }, [source]);

  useLayoutEffect(() => {
    if (amount !== undefined) source.amount = amount;
  }, [source, amount]);
}

/**
 * Applies `settings` to ready-made weather hooks, unset settings at the hooks' defaults. Compared by value,
 * so an inline object with the same settings writes nothing.
 */
function useSettings<S>(hooks: { readonly settings: object; set(settings: S): unknown }, settings: S): void {
  const defaults = useMemo(() => hooks.settings, [hooks]);
  const key = JSON.stringify(settings);
  useLayoutEffect(() => {
    const given = Object.fromEntries(Object.entries(settings as object).filter(([, value]) => value !== undefined));
    const strength = { ...(defaults as { strength: object }).strength, ...(given as { strength?: object }).strength };
    hooks.set({ ...defaults, ...given, strength } as S);
    // `key` stands for the settings by value.
  }, [hooks, defaults, key]);
}

/**
 * What `<SnowCover>` and `<Wetness>` share: the ready-made hooks with `settings` applied, `amount` written
 * to `source`, the hooks set scene-wide while mounted and handed to `ref`.
 */
function useWeatherHooks<H extends TreeShaderHooks & { readonly settings: object; set(settings: S): unknown }, S>(
  hooks: H,
  source: Amount,
  amount: number | undefined,
  settings: S,
  ref: Ref<H | null> | undefined,
): void {
  useSettings<S>(hooks, settings);
  useAmount(source, amount);
  useSceneShaderHooks(hooks);
  useImperativeHandle(ref, () => hooks, [hooks]);
}

export interface SnowCoverProps extends SnowCoverSettings {
  /** The snow amount, 0 (none) .. 1 (full cover): written to `snow`. Unset: leave as is (default 0). */
  amount?: number;
  /** The `Snow` the hooks follow and `amount` drives. Default: the scene-wide `sceneSnow`. A new one makes new hooks. */
  snow?: Snow;
  /** Receives the ready-made Snow Cover hooks (`SnowCoverHooks`), e.g. to also hand them to a `<Tree shaderHooks>`. */
  ref?: Ref<SnowCoverHooks | null>;
}

/**
 * Declares Snow Cover (`@casmo/tree.js/weather`): while mounted, every tree runs the ready-made Snow Cover
 * hooks as scene-wide Tree Shader Hooks (before the app's own), whitening surfaces that face up by `amount`.
 * Renders nothing. `amount` and the settings are uniform writes (no rebuild); an unset setting is its
 * default. On unmount the hooks are removed and the amount it found is put back. Loads the weather module
 * on first use: suspends.
 *
 * ```tsx
 * <SnowCover amount={0.8} slope={60} />
 * ```
 */
export function SnowCover({ amount, snow, ref, ...settings }: SnowCoverProps): null {
  const { sceneSnow, snowCoverHooks } = use(weatherResource());
  const source = snow ?? sceneSnow;
  const hooks = useMemo(() => snowCoverHooks({ snow: source }), [snowCoverHooks, source]);
  useWeatherHooks<SnowCoverHooks, SnowCoverSettings>(hooks, source, amount, settings, ref);
  return null;
}

export interface WetnessProps extends WetnessSettings {
  /** The wetness amount, 0 (dry) .. 1 (soaked): written to `wetness`. Unset: leave as is (default 0). */
  amount?: number;
  /** The `Wetness` the hooks follow and `amount` drives. Default: the scene-wide `sceneWetness`. A new one makes new hooks. */
  wetness?: WetnessAmount;
  /** Receives the ready-made Wetness hooks (`WetnessHooks`), e.g. to also hand them to a `<Tree shaderHooks>`. */
  ref?: Ref<WetnessHooks | null>;
}

/**
 * Declares Wetness (`@casmo/tree.js/weather`): while mounted, every tree runs the ready-made Wetness hooks
 * as scene-wide Tree Shader Hooks (before the app's own): darker, with a sheen, by `amount`. Renders
 * nothing. `amount` and the settings are uniform writes (no rebuild); an unset setting is its default. On
 * unmount the hooks are removed and the amount it found is put back. Loads the weather module on first
 * use: suspends.
 *
 * ```tsx
 * <Wetness amount={0.6} sheen={0.7} />
 * ```
 */
export function Wetness({ amount, wetness, ref, ...settings }: WetnessProps): null {
  const { sceneWetness, wetnessHooks } = use(weatherResource());
  const source = wetness ?? sceneWetness;
  const hooks = useMemo(() => wetnessHooks({ wetness: source }), [wetnessHooks, source]);
  useWeatherHooks<WetnessHooks, WetnessSettings>(hooks, source, amount, settings, ref);
  return null;
}
