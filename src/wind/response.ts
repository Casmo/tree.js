import type { UniformNode } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { WindResponseDefinition } from '../definition';

/**
 * One tree's response to the Wind (from its Definition's `wind`), held in uniforms so the
 * Tree Editor can change it live. `height` (trunk height) and `phase` (from the Seed) shape the
 * motion: the sway scales with the tree, and trees of different Seeds move out of step.
 */
export class WindResponse {
  readonly uniforms: {
    readonly trunk: UniformNode<'float', number>;
    readonly branches: UniformNode<'float', number>;
    readonly leaves: UniformNode<'float', number>;
    readonly frequency: UniformNode<'float', number>;
    readonly height: UniformNode<'float', number>;
    /** Radians, 0..2π. */
    readonly phase: UniformNode<'float', number>;
  };

  constructor(response: WindResponseDefinition, shape: { height: number; phase: number }) {
    this.uniforms = {
      trunk: uniform(0),
      branches: uniform(0),
      leaves: uniform(0),
      frequency: uniform(1),
      height: uniform(shape.height),
      phase: uniform(shape.phase),
    };
    this.set(response);
  }

  /** The current response, as in the Definition's `wind`. */
  get values(): WindResponseDefinition {
    const u = this.uniforms;
    return { trunk: u.trunk.value, branches: u.branches.value, leaves: u.leaves.value, frequency: u.frequency.value };
  }

  /** Changes part of the response (uniform writes only). Weights are 0..1, frequency > 0. */
  set(response: Partial<WindResponseDefinition>): this {
    for (const key of ['trunk', 'branches', 'leaves'] as const) {
      const value = response[key];
      if (value === undefined) continue;
      if (!(value >= 0 && value <= 1)) throw new RangeError(`wind.${key} must be within 0..1, got ${value}`);
      this.uniforms[key].value = value;
    }
    if (response.frequency !== undefined) {
      if (!(response.frequency > 0 && Number.isFinite(response.frequency))) {
        throw new RangeError(`wind.frequency must be > 0, got ${response.frequency}`);
      }
      this.uniforms.frequency.value = response.frequency;
    }
    return this;
  }
}
