import { Color, type Node as FloatNode, type NodeMaterial, type UniformNode } from 'three/webgpu';
import { attribute, float, fract, mix, positionLocal, select, uniform, varying, vec4 } from 'three/tsl';
import type { Keyframe, SeasonProfileDefinition } from '../definition';
import { fruitTracks, KEYFRAME_EPSILON } from './profile';

/** A float uniform (`.value` is the Season). */
export type SeasonUniform = UniformNode<'float', number>;

// TSL node types are loosely typed in @types/three; keep our own alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

/**
 * Unrolls a keyframe track into a chain of mixes over uniforms (one per segment). Same maths
 * as `sampleTrack` in `./profile.ts`. Key times and values are uniforms, so editing a value
 * never recompiles; only a different key count does.
 */
function keyframeNode<V>(s: Node, track: readonly Keyframe<V>[], toUniform: (v: V) => Node): Node {
  return keyframeSampler(track, toUniform)(s);
}

/** As `keyframeNode`, with the uniforms made once: the returned function samples the track at any Season node. */
function keyframeSampler<V>(track: readonly Keyframe<V>[], toUniform: (v: V) => Node): (s: Node) => Node {
  const ts: Node[] = track.map((k) => uniform(k.t));
  const vs: Node[] = track.map((k) => toUniform(k.value));
  return (s) => {
    let out: Node = vs[0];
    for (let i = 0; i < track.length - 1; i++) {
      const f = s.sub(ts[i]).div(ts[i + 1]!.sub(ts[i]).max(KEYFRAME_EPSILON)).clamp(0, 1);
      out = mix(out, vs[i + 1], f);
    }
    return out;
  };
}

/** One leaf at one Season (TSL): see {@link leafSeasonNode}. */
export interface LeafSeasonNode {
  /** Leaf colour (vec3, linear) at the leaf's shifted Season, or the blossom colour for a blossom. */
  color: Node;
  /** True while the leaf is shown (coverage above its rank, or a blossom). */
  shown: Node;
}

/**
 * The TSL twin of `leafSeason` for a Season Profile: returns a function that evaluates one leaf from
 * a Season node and its Season timing (vec3: shift, coverage rank, blossom rank, as `aSeason`). The
 * Profile's uniforms are made once, so it can be called for many leaves (an Impostor's frames).
 */
export function leafSeasonNode(profile: SeasonProfileDefinition): (season: FloatNode<'float'>, part: Node) => LeafSeasonNode {
  const leafColor = keyframeSampler(profile.leafColor, (v) => uniform(new Color(v)));
  const coverage = keyframeSampler(profile.leafCoverage, (v) => uniform(v));
  const blossom = keyframeSampler(profile.blossom, (v) => uniform(v));
  const blossomColor = uniform(new Color(profile.blossomColor));
  return (season, part) => {
    const s = shiftedSeason(season, part);
    const isBlossom = blossom(s).greaterThan(part.z);
    return { color: select(isBlossom, blossomColor, leafColor(s)), shown: isBlossom.or(coverage(s).greaterThan(part.y)) };
  };
}

/**
 * The Season Profile's leaf colour (vec3, linear) at a Season node, for the whole tree (no per-leaf timing
 * shift, never the blossom colour): what the `enchanted` bark veins glow in.
 */
export function seasonLeafColorNode(profile: Pick<SeasonProfileDefinition, 'leafColor'>, season: FloatNode<'float'>): Node {
  return keyframeNode(season, profile.leafColor, (v) => uniform(new Color(v)));
}

/** The Season nodes of one tree's leaves; `S` is the Season input node (a uniform by default). */
export interface SeasonNodes<S extends FloatNode<'float'> = SeasonUniform> {
  /** Season 0..1 (first day of spring .. last day of winter). For a uniform: write `.value`; nothing recompiles. */
  season: S;
  /** Leaf colour (vec3, linear) at this leaf's shifted Season, or the blossom colour for a blossom. */
  color: Node;
  /** True while the leaf is shown (coverage above its rank, or a blossom). For `maskNode`. */
  visible: Node;
}

/**
 * Builds the TSL nodes that evaluate a Season Profile per leaf, from the `aSeason` vertex
 * attribute (Seed timing shift, coverage rank, blossom rank). The TSL twin of `leafSeason`.
 * Evaluated in the vertex stage (constant per leaf) and passed on as varyings.
 *
 * `season` is the Season input: a new uniform by default, or any float node (a Forest passes its
 * per-instance Season attribute).
 */
export function createSeasonNodes(profile: SeasonProfileDefinition): SeasonNodes;
export function createSeasonNodes<S extends FloatNode<'float'>>(profile: SeasonProfileDefinition, season: S): SeasonNodes<S>;
export function createSeasonNodes(profile: SeasonProfileDefinition, season: FloatNode<'float'> = uniform(0)): SeasonNodes<FloatNode<'float'>> {
  const { color, shown } = leafSeasonNode(profile)(season, attribute('aSeason', 'vec3'));
  return {
    season,
    color: varying(color),
    visible: varying(select(shown, float(1), float(0))).greaterThan(0.5),
  };
}

/** The part's own Season: the Season input plus the `aSeason.x` timing shift, wrapped around the year (as `wrapSeason`). */
function shiftedSeason(season: Node, aSeason: Node): Node {
  const shifted = season.add(aSeason.x);
  return select(shifted.greaterThan(1).or(shifted.lessThan(0)), fract(shifted), shifted);
}

/** The Season nodes of one tree's Fruit. */
export interface FruitSeasonNodes {
  /** Fruit colour (vec3, linear) at this Fruit's shifted Season. */
  color: Node;
  /** Size of the Fruit (0 = not set or dropped .. 1 = full size). */
  scale: Node;
  /** The vertex position (default `positionLocal`) scaled about the Fruit's attachment point (`aOrigin`) by `scale`. */
  position: Node;
}

/**
 * Builds the TSL nodes that evaluate the Season Profile's Fruit tracks per Fruit, from the fruit
 * mesh's `aSeason` (timing shift, Fruit rank). The TSL twin of `fruitSeason`: a Fruit shows while
 * the Fruit amount is above its rank and swells with the amount. `season` is the Season input
 * (share the leaves' uniform so one write drives both).
 */
export function createFruitSeasonNodes(
  profile: SeasonProfileDefinition,
  season: FloatNode<'float'>,
  position: Node = positionLocal,
): FruitSeasonNodes {
  const aSeason = attribute('aSeason', 'vec3');
  const origin = attribute('aOrigin', 'vec3');
  const s = shiftedSeason(season, aSeason);
  const tracks = fruitTracks(profile);
  const amount = keyframeNode(s, tracks.fruit, (v) => uniform(v));
  const scale = select(amount.greaterThan(aSeason.y), amount, float(0));
  return {
    color: varying(keyframeNode(s, tracks.fruitColor, (v) => uniform(new Color(v)))),
    scale,
    position: origin.add(position.sub(origin).mul(scale)),
  };
}

/**
 * Hooks Season into a leaf material: `colorNode` (times the vertex-colour tint, and times the
 * material's existing `colorNode`, such as a leaf card texture with alpha) and `maskNode`, which
 * also cuts fallen leaves out of the shadow pass.
 */
export function applySeasonToLeafMaterial(material: NodeMaterial, nodes: Pick<SeasonNodes, 'color' | 'visible'>): void {
  material.colorNode = material.colorNode ? vec4(nodes.color, 1).mul(material.colorNode as Node) : nodes.color;
  material.maskNode = nodes.visible;
}
