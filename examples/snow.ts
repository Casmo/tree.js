// Shared by the vanilla and forest examples (and e2e/snow-cover.spec.ts): Snow Cover, the ready-made Tree
// Shader Hook from the opt-in `@casmo/tree.js/weather` entry, on the scene-wide snow amount.
import { select, vec3 } from 'three/tsl';
import type { TreeShaderHook, TreeShaderHooks } from '@casmo/tree.js';
import { sceneSnow, SnowCover, type SnowCoverOptions } from '@casmo/tree.js/weather';

/** What `setSnow` changes: which hooks are set, the scene-wide amount and the Snow Cover settings. */
export interface SnowExampleOptions {
  /** 'snow': Snow Cover; 'facing': the facing test hook (below); 'none': no hook. */
  hook?: 'snow' | 'facing' | 'none';
  amount?: number;
  settings?: Omit<SnowCoverOptions, 'snow'>;
}

const snowCover = new SnowCover();

/**
 * A test hook that paints what a surface faces, by the same world normal Snow Cover reads: magenta where
 * it faces up (normal y > 0.85), cyan where it faces down (normal y < -0.1), the colour as is elsewhere.
 */
const facing: TreeShaderHook = ({ color, normal }) => {
  const y = normal.normalize().y;
  return select(y.greaterThan(0.85), vec3(1, 0, 1), select(y.lessThan(-0.1), vec3(0, 1, 1), color));
};
const facingHooks: TreeShaderHooks = { bark: facing, leaves: facing, fruit: facing };

/** Applies `options` with `setHooks` (the Tree's or Forest's `shaderHooks`). */
export function setSnow(setHooks: (hooks: TreeShaderHooks) => void, { hook, amount, settings }: SnowExampleOptions): void {
  if (hook) setHooks(hook === 'snow' ? snowCover : hook === 'facing' ? facingHooks : {});
  if (amount !== undefined) sceneSnow.amount = amount;
  if (settings) snowCover.set(settings);
}
