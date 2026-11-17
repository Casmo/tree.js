import { use } from 'react';
import { loadStyle, type StyleName } from '../styles/registry';
import type { TreeStyle } from '../styles/types';

// One promise per Style name, so every render (and every component) suspends on the same load.
const cache = new Map<string, Promise<TreeStyle>>();

function styleResource(name: StyleName): Promise<TreeStyle> {
  let promise = cache.get(name);
  if (!promise) {
    promise = loadStyle(name);
    cache.set(name, promise);
    // A failed load is not cached, so a later render can retry (the error still reaches the error boundary).
    promise.catch(() => cache.delete(name));
  }
  return promise;
}

/**
 * Loads a built-in Style with a dynamic import and returns it. Suspends (React Suspense) while
 * it downloads, so wrap the component in `<Suspense>`. Unknown names throw to the nearest error boundary.
 *
 * ```tsx
 * const lowPoly = useTreeStyle('low-poly');
 * return <Tree style={lowPoly} form="conifer" seed={7} />;
 * ```
 */
export function useTreeStyle(name: StyleName): TreeStyle {
  return use(styleResource(name));
}

/** Starts loading a Style ahead of time (e.g. on hover), without suspending. */
export function preloadTreeStyle(name: StyleName): void {
  void styleResource(name).catch(() => {});
}
