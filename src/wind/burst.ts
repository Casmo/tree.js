import { Node, type Material, type NodeBuilder, type UniformArrayNode } from 'three/webgpu';
import { cos, exp, Fn, int, Loop, modelWorldMatrix, modelWorldMatrixInverse, nodeObject, select, smoothstep, step, vec2, vec4 } from 'three/tsl';
import { WIND_BURST_LIFETIME, type BurstListener } from './Wind';
import type { WindSource } from './node';

// The shape of a Wind Burst: a front travelling out from the burst point, a quick rise and a short swing back.
/** Metres per second the front travels outward from the burst point. */
const SPEED = 30;
/** Seconds the push takes to rise as the front passes, and to decay after. */
const RISE = 0.04;
const TAIL = 0.4;
/** The push follows cos(SWING × since): the lean away crosses zero after 0.5 s and springs back a little. */
const SWING = Math.PI;
/** Reduced motion (negative strength): everything in reach leans at once by this much, fading over REDUCED_FADE s. */
const REDUCED_PEAK = 0.5;
const REDUCED_FADE = 0.6;
/** The whole burst fades out over the last 40 % of its lifetime. */
const LIFE_FADE_FROM = WIND_BURST_LIFETIME * 0.6;

/**
 * TSL node: the push of the Wind Bursts of `wind` at a world-space ground point `xz` (vec2: world
 * x, z), summed over the running bursts: away from each burst point, about 0..0.75 × strength at
 * its peak, 0 beyond the burst's radius and once it has ended. `time` is the Wind time to evaluate
 * it at (default the Wind's clock), e.g. the previous frame's for Wind-aware velocity. With no
 * burst running the loop runs zero times and the push is exactly 0.
 */
export function windBurstPush(wind: WindSource, xz: Node<'vec2'>, time: Node<'float'> = wind.uniforms.time): Node<'vec2'> {
  const { points, radii, count } = wind.uniforms.bursts;
  // The uniforms are passed in (not closed over), so they are part of the node graph.
  return burstPush(points, radii, count, xz, time);
}

type BurstPushInputs = [UniformArrayNode<'vec4'>, UniformArrayNode<'float'>, Node<'int'>, Node<'vec2'>, Node<'float'>];

const burstPush = Fn(([points, radii, count, xz, time]: BurstPushInputs) => {
  const push = vec2(0).toVar();
  Loop({ start: int(0), end: count, type: 'int', condition: '<' }, ({ i }) => {
    const burst = points.element(i); // x, z, start, strength
    const strength = burst.w;
    const age = time.sub(burst.z);
    const away = xz.sub(burst.xy);
    const distance = away.length();
    // Clamped, so the rise term never overflows before the front arrives (it is 0 there anyway).
    const since = age.sub(distance.div(SPEED)).max(0);
    const swing = exp(since.div(-RISE)).oneMinus().mul(exp(since.div(-TAIL))).mul(cos(since.mul(SWING)));
    const reduced = smoothstep(0, REDUCED_FADE, age).oneMinus().mul(REDUCED_PEAK);
    const pulse = select(strength.lessThan(0), reduced, swing);
    const falloff = smoothstep(0, radii.element(i), distance).oneMinus();
    const life = smoothstep(LIFE_FADE_FROM, WIND_BURST_LIFETIME, age).oneMinus().mul(step(0, age)).mul(step(age, WIND_BURST_LIFETIME));
    push.addAssign(away.div(distance.max(1e-3)).mul(pulse.mul(falloff).mul(life).mul(strength.abs())));
  });
  return push;
}) as unknown as (...inputs: BurstPushInputs) => Node<'vec2'>;

/**
 * Where a Wind Burst finds a tree and how its push turns into the tree's space: a Tree is the
 * rendered object ({@link objectBurstFrame}); a tree drawn as an instance passes its own.
 */
export interface WindBurstFrame {
  /** The tree's world-space ground point (vec2: world x, z). */
  origin: Node<'vec2'>;
  /** Turns a world-space vector into the tree's space: rotation only, its length kept. */
  toTree(world: Node<'vec3'>): Node<'vec3'>;
}

/** The {@link WindBurstFrame} of a tree that is one object: its world origin and rotation. */
export function objectBurstFrame(): WindBurstFrame {
  return {
    origin: modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xz,
    toTree: (world) => {
      const local = modelWorldMatrixInverse.mul(vec4(world, 0)).xyz;
      // Rotation only: undo the inverse scale (0 stays 0).
      return local.mul(world.length().div(local.length().max(1e-6)));
    },
  };
}

/**
 * A Wind displacement that only takes Wind Bursts once they are used: it is `still` (the displacement
 * without bursts, exactly as before Wind Bursts existed) until the first burst on `source`'s Wind, then
 * `withBursts()`, built once. The switch is one-time: every material built with it is marked for a
 * rebuild of its node graph (`needsUpdate`), never its geometry. The node is transparent: it builds to,
 * traverses and hashes as the displacement it holds.
 */
class WindBurstSwitchNode extends Node implements BurstListener {
  static get type(): string {
    return 'WindBurstSwitchNode';
  }

  /** The displacement drawn now (the only child, so traversal sees only what is drawn). */
  node: Node<'vec3'>;
  #withBursts: (() => Node<'vec3'>) | null;
  readonly #materials = new Set<WeakRef<Material>>();

  constructor(source: WindSource, still: Node<'vec3'>, withBursts: () => Node<'vec3'>) {
    super('vec3');
    this.node = still;
    this.#withBursts = withBursts;
    source.uniforms.bursts.used.listen(this);
  }

  burstsUsed(): void {
    if (!this.#withBursts) return;
    this.node = this.#withBursts();
    this.#withBursts = null;
    this.needsUpdate = true;
    for (const ref of this.#materials) {
      const material = ref.deref();
      if (material) material.needsUpdate = true;
    }
    this.#materials.clear();
  }

  override getCacheKey(force?: boolean, ignores?: Set<Node>): number {
    return this.node.getCacheKey(force, ignores);
  }

  override setup(builder: NodeBuilder): Node {
    if (this.#withBursts && builder.material) this.#materials.add(new WeakRef(builder.material));
    return this.node;
  }
}

/**
 * TSL node: the Wind displacement `still`, plus Wind Bursts once `source`'s Wind has had one: then
 * `withBursts()` (built at that moment, once). See {@link WindBurstSwitchNode}.
 */
export function withWindBursts(source: WindSource, still: Node<'vec3'>, withBursts: () => Node<'vec3'>): Node<'vec3'> {
  return nodeObject(new WindBurstSwitchNode(source, still, withBursts)) as unknown as Node<'vec3'>;
}
