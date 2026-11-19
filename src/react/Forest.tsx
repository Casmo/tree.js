import { useEffect, useLayoutEffect, useMemo, useState, type Ref } from 'react';
import type { ThreeElements } from '@react-three/fiber';
import type { TreeDefinition, TreeDefinitionInput, TreeForm } from '../definition';
import type { TreeStyle } from '../styles/types';
import type { StyleName } from '../styles/registry';
import { createForest, type Forest as ForestObject } from '../forest';
import { forestTreeKey, type ForestPlacement } from '../forest/placement';
import { DEFAULT_LOD_FADE, defaultDetailLevelDistances, type ForestLodOptions, type ForestLodUpdate } from '../forest/lod';
import { trunkHeight } from '../generator';
import { clampGrowth } from '../growth/evaluate';
import { wrapSeason } from '../season/profile';
import { sceneWind, type Wind as WindObject } from '../wind';
import { useTreeStyle } from './useTreeStyle';

type GroupProps = Omit<ThreeElements['group'], 'args' | 'object' | 'children' | 'ref' | 'castShadow' | 'receiveShadow' | 'dispose'>;

/** Where one tree of a `<Forest>` stands, optionally with its own Growth and Season. */
export interface ForestTreePlacement extends ForestPlacement {
  /** This tree's Growth, 0..1. Default: the forest's `growth`. */
  growth?: number;
  /** This tree's Season, 0..1 (wraps). Default: the forest's `season`. */
  season?: number;
}

export interface ForestProps extends GroupProps {
  /** The Tree Definition every tree is grown from (plain object or parsed JSON). Takes precedence over `style`. */
  definition?: TreeDefinitionInput | TreeDefinition;
  /** A Style (object from {@link useTreeStyle}, or a built-in Style name, loaded on demand: suspends). */
  style?: TreeStyle | StyleName;
  /** Which of the Style's Forms to grow. Default 'broadleaf'. */
  form?: TreeForm;
  /** How many Variants (distinct trees, each drawn instanced). Default 4. Changing it rebuilds the forest. */
  variants?: number;
  /** The forest seed. Default 0. Changing it rebuilds the forest. */
  seed?: number;
  /**
   * The trees. Trees are matched by key (their `id`, or their position without one), so adding or
   * removing placements only plants or cuts those trees; the others keep their look and instance data.
   */
  placements: readonly ForestTreePlacement[];
  /** Growth of every tree without its own `growth`, 0..1. Default 1. Only rewrites instance data. */
  growth?: number;
  /** Season of every tree without its own `season`, 0..1 (wraps). Default 0. Only rewrites instance data. */
  season?: number;
  /** The Wind the forest sways with. Default: the scene-wide `sceneWind` (what `<Wind>` sets). */
  wind?: WindObject;
  /**
   * Detail Levels (ADR 0010), as `createForest`'s `lod`: `true` for the automatic distances, or the
   * distances. Switching it on or off, or a new `impostorAtlas` or `lightDefinition` (by value),
   * rebuilds the forest; new `light`, `impostor`, `fade` or `camera` only write `forest.lod`.
   */
  lod?: boolean | ForestLodOptions;
  /** Whether the trees cast shadows. Default true. */
  castShadow?: boolean;
  /** Whether the trees receive shadows. Default true. */
  receiveShadow?: boolean;
  /** Receives the tree.js `Forest` object (a three.js Group). */
  ref?: Ref<ForestObject>;
}

/** Forests this module has disposed of (React StrictMode re-runs effects on the same memoised forest). */
const disposed = new WeakSet<ForestObject>();

/** The placement without the React-only per-tree state. */
function placementOf(p: ForestTreePlacement): ForestPlacement {
  const placement = { ...p };
  delete placement.growth;
  delete placement.season;
  return placement;
}

/** What makes a tree stand where it does; a change re-plants the tree. */
function pose(p: ForestPlacement): string {
  const v = p.position;
  const position = Array.isArray(v) ? [v[0], v[1], v[2]] : [(v as { x: number }).x, (v as { y: number }).y, (v as { z: number }).z];
  return JSON.stringify([position, p.rotation ?? 0, p.scale ?? 1]);
}

/** What of `lod` needs a new forest: whether it is on, the Impostor atlas and the Light Definition. */
function lodBuildKey(lod: boolean | ForestLodOptions | undefined): string | null {
  if (!lod) return null;
  const options: Partial<ForestLodOptions> = lod === true ? {} : lod;
  return JSON.stringify([options.impostorAtlas ?? null, options.lightDefinition ?? null]);
}

/** The live part of `lod` (every default filled in; `tallest`: the tallest Variant's trunk height), or null when lod is off. */
function lodUpdate(lod: boolean | ForestLodOptions | undefined, tallest: () => number): Required<ForestLodUpdate> | null {
  if (!lod) return null;
  if (lod === true) return { ...defaultDetailLevelDistances(tallest()), fade: DEFAULT_LOD_FADE, camera: null };
  return { light: lod.light, impostor: lod.impostor, fade: lod.fade ?? DEFAULT_LOD_FADE, camera: lod.camera ?? null };
}

/**
 * Brings `forest` in line with `placements`: cuts trees that are no longer placed, plants new ones,
 * re-plants moved ones, and writes Growth/Season only where they differ. Untouched trees are not rewritten.
 */
function syncForest(forest: ForestObject, placements: readonly ForestTreePlacement[], growth: number, season: number): void {
  if (forest.growth !== clampGrowth(growth)) forest.growth = growth;
  if (forest.season !== wrapSeason(season)) forest.season = season;

  const wanted = new Map<string, ForestTreePlacement>();
  for (const p of placements) {
    const key = forestTreeKey(p);
    if (wanted.has(key)) throw new Error(`<Forest> placements have two trees with key "${key}"`);
    wanted.set(key, p);
  }
  for (const tree of forest.trees) {
    const p = wanted.get(tree.key);
    if (!p || pose(p) !== pose(tree.placement)) forest.removeTree(tree);
  }
  for (const [key, p] of wanted) {
    const tree = forest.get(key) ?? forest.addTree(placementOf(p));
    const g = p.growth ?? growth;
    const s = p.season ?? season;
    if (tree.growth !== clampGrowth(g)) tree.growth = g;
    if (tree.season !== wrapSeason(s)) tree.season = s;
  }
}

/**
 * Many trees of one Definition, drawn instanced (a `Forest`). Changing `placements` plants or cuts
 * only the affected trees; Growth, Season, Wind and shadow props only update instance data, uniforms
 * and meshes; changing `lod` distances, fade or camera only writes `forest.lod`. A new `definition`
 * (by value), `style`/`form`, `variants`, `seed`, or switching `lod` on or off rebuilds the forest.
 * The forest is disposed of on unmount.
 */
export function Forest({
  definition,
  style,
  form = 'broadleaf',
  variants = 4,
  seed = 0,
  placements,
  growth = 1,
  season = 0,
  wind,
  castShadow = true,
  receiveShadow = true,
  lod,
  ref,
  ...groupProps
}: ForestProps) {
  const styleObject = definition === undefined && typeof style === 'string' ? useTreeStyle(style) : style;
  const source = definition ?? (typeof styleObject === 'object' ? styleObject[form] : undefined);
  if (source === undefined) throw new Error('<Forest> needs a `definition` or a `style`.');
  const key = JSON.stringify(source);

  const lodKey = lodBuildKey(lod);

  const [generation, setGeneration] = useState(0);
  const forest = useMemo(
    () => createForest(JSON.parse(key) as TreeDefinitionInput, [], { variants, seed, wind, growth, season, lod }),
    // placements/growth/season/wind and the live lod settings are synced by the layout effects below.
    [key, variants, seed, lodKey, generation],
  );

  useEffect(() => {
    if (disposed.has(forest)) setGeneration((g) => g + 1);
    return () => {
      disposed.add(forest);
      forest.dispose();
    };
  }, [forest]);

  useLayoutEffect(() => {
    forest.wind = wind ?? sceneWind;
  }, [forest, wind]);

  const tallest = useMemo(() => {
    let height: number | undefined;
    return () => (height ??= Math.max(...forest.variants.map((v) => trunkHeight(v.data.skeleton))));
  }, [forest]);
  const live = lodUpdate(lod, tallest);
  useLayoutEffect(() => {
    const current = forest.lod;
    if (!live || !current) return;
    if (live.light !== current.light || live.impostor !== current.impostor || live.fade !== current.fade || live.camera !== current.camera) {
      forest.lod = live;
    }
  }, [forest, live?.light, live?.impostor, live?.fade, live?.camera]);

  useLayoutEffect(() => {
    syncForest(forest, placements, growth, season);
  }, [forest, placements, growth, season]);

  useLayoutEffect(() => {
    for (const variant of forest.variants) {
      for (const mesh of variant.meshes) {
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
      }
    }
  }, [forest, castShadow, receiveShadow, placements]);

  return <primitive object={forest} ref={ref} {...groupProps} />;
}
