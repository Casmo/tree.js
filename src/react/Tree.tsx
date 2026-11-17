import { useEffect, useLayoutEffect, useMemo, useState, type Ref } from 'react';
import type { ThreeElements } from '@react-three/fiber';
import type { TreeDefinition, TreeDefinitionInput, TreeForm } from '../definition';
import type { TreeStyle } from '../styles/types';
import type { StyleName } from '../styles/registry';
import { createTree, type Tree as TreeObject } from '../tree';
import { sceneWind, type Wind as WindObject } from '../wind';
import { useTreeStyle } from './useTreeStyle';

type GroupProps = Omit<ThreeElements['group'], 'args' | 'object' | 'children' | 'ref' | 'castShadow' | 'receiveShadow' | 'dispose'>;

export interface TreeProps extends GroupProps {
  /** The Tree Definition to grow (plain object or parsed JSON). Takes precedence over `style`. */
  definition?: TreeDefinitionInput | TreeDefinition;
  /**
   * A Style: its Definition for `form` is grown. Pass the object from {@link useTreeStyle}, or a
   * built-in Style name, which is loaded on demand (the component suspends until it is there).
   */
  style?: TreeStyle | StyleName;
  /** Which of the Style's Forms to grow. Default 'broadleaf'. */
  form?: TreeForm;
  /** Picks one individual tree within the Definition's ranges. Default 0. Changing it regenerates the tree. */
  seed?: number;
  /** Growth 0 (sapling) .. 1 (default). Only updates a uniform. */
  growth?: number;
  /** Season 0 .. 1 (wraps). Only updates a uniform. */
  season?: number;
  /** The Wind this tree sways with. Default: the scene-wide `sceneWind` (what `<Wind>` sets). */
  wind?: WindObject;
  /** Whether the tree casts shadows. Default true. */
  castShadow?: boolean;
  /** Whether the tree receives shadows. Default true. */
  receiveShadow?: boolean;
  /** Receives the tree.js `Tree` object (a three.js Group). */
  ref?: Ref<TreeObject>;
}

/** Trees this module has disposed of (React StrictMode re-runs effects on the same memoised tree). */
const disposed = new WeakSet<TreeObject>();

/**
 * A procedural tree. Growth, Season, Wind and shadow props only update the existing tree; a new
 * `seed`, `definition` (by value) or `style`/`form` regenerates it. The tree is disposed
 * of on unmount.
 */
export function Tree({
  definition,
  style,
  form = 'broadleaf',
  seed = 0,
  growth = 1,
  season = 0,
  wind,
  castShadow = true,
  receiveShadow = true,
  ref,
  ...groupProps
}: TreeProps) {
  // `use()` (behind useTreeStyle) may be called conditionally, so a style name suspends right here.
  const styleObject = definition === undefined && typeof style === 'string' ? useTreeStyle(style) : style;
  const source = definition ?? (typeof styleObject === 'object' ? styleObject[form] : undefined);
  if (source === undefined) throw new Error('<Tree> needs a `definition` or a `style`.');
  // Compare Definitions by value, so an inline object literal does not regenerate on every render.
  const key = JSON.stringify(source);

  // Bumped when StrictMode disposed the memoised tree, to grow a fresh one.
  const [generation, setGeneration] = useState(0);
  const tree = useMemo(
    () => createTree(JSON.parse(key) as TreeDefinitionInput, { seed, wind, growth, season }),
    // growth/season/wind are only the starting values; the effects below keep them in sync.
    [key, seed, generation],
  );

  useEffect(() => {
    if (disposed.has(tree)) setGeneration((g) => g + 1);
    return () => {
      disposed.add(tree);
      tree.dispose();
    };
  }, [tree]);

  useLayoutEffect(() => {
    tree.wind = wind ?? sceneWind;
  }, [tree, wind]);

  useLayoutEffect(() => {
    tree.growth = growth;
  }, [tree, growth]);

  useLayoutEffect(() => {
    tree.season = season;
  }, [tree, season]);

  useLayoutEffect(() => {
    for (const mesh of [tree.wood, tree.leaves]) {
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
    }
  }, [tree, castShadow, receiveShadow]);

  return <primitive object={tree} ref={ref} {...groupProps} />;
}
