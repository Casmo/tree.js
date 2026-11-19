import { useLayoutEffect, useRef } from 'react';
import { getSceneShaderHooks, setSceneShaderHooks, stackShaderHooks, type TreeShaderHooks } from '../materials/shader-hooks';

/** The hooks one mounted component adds to the scene-wide default. */
interface Contribution {
  hooks: TreeShaderHooks;
}

// The mounted contributions, in the order they mounted, and the scene-wide hooks found before the first.
const contributions: Contribution[] = [];
let found: TreeShaderHooks = {};

/** Sets the scene-wide default to what was there before React, stacked with every contribution. */
function publish(): void {
  setSceneShaderHooks(stackShaderHooks(found, ...contributions.map((c) => c.hooks)));
}

/**
 * @internal Adds `hooks` to the scene-wide default Tree Shader Hooks while the calling component is
 * mounted (after the ones the scene had, and the ones of components mounted earlier). Only a change of a
 * part's hooks rebuilds that part's node graphs. The last one to unmount puts back what it found.
 */
export function useSceneShaderHooks(hooks: TreeShaderHooks | null): void {
  const contribution = useRef<Contribution | null>(null);

  useLayoutEffect(() => {
    if (contributions.length === 0) found = getSceneShaderHooks();
    const entry: Contribution = { hooks: {} };
    contributions.push(entry);
    contribution.current = entry;
    return () => {
      contributions.splice(contributions.indexOf(entry), 1);
      contribution.current = null;
      if (contributions.length === 0) setSceneShaderHooks(found);
      else publish();
    };
  }, []);

  useLayoutEffect(() => {
    contribution.current!.hooks = hooks ?? {};
    publish();
  }, [hooks]);
}

export interface SceneShaderHooksProps {
  /**
   * Tree Shader Hooks every `<Tree>` and `<Forest>` (and every Tree and Forest made outside React) runs,
   * before its own. Keep hooks stable (module scope or `useMemo`): a new function is a new hook.
   */
  hooks: TreeShaderHooks;
}

/**
 * Declares scene-wide default Tree Shader Hooks (`setSceneShaderHooks`). Renders nothing. Several stack in
 * the order they mounted, after the hooks the scene had before; when the last one unmounts, those are put
 * back. Changing `hooks` only rebuilds the node graphs of the parts whose hooks changed, once.
 *
 * ```tsx
 * <SceneShaderHooks hooks={{ leaves: frosty }} />
 * ```
 */
export function SceneShaderHooks({ hooks }: SceneShaderHooksProps): null {
  useSceneShaderHooks(hooks);
  return null;
}
