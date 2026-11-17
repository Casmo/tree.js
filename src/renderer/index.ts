/** Thrown when a tree is drawn by anything other than `WebGPURenderer` (ADR 0002). */
export class UnsupportedRendererError extends Error {
  constructor(what: string) {
    super(
      `tree.js requires WebGPURenderer (import { WebGPURenderer } from 'three/webgpu'), but the tree is being drawn by ${what}. ` +
        'The classic WebGLRenderer is not supported because tree materials are TSL node materials. ' +
        'WebGPURenderer runs on WebGPU and falls back to WebGL2 by itself, so switching renderers keeps WebGL2 support.',
    );
    this.name = 'UnsupportedRendererError';
  }
}

interface RendererLike {
  isWebGPURenderer?: boolean;
  isWebGLRenderer?: boolean;
}

/** Throws {@link UnsupportedRendererError} unless `renderer` is a `WebGPURenderer` (either backend). */
export function assertWebGPURenderer(renderer: unknown): void {
  const r = renderer as RendererLike | null | undefined;
  if (r?.isWebGPURenderer === true) return;
  throw new UnsupportedRendererError(r?.isWebGLRenderer ? 'the classic WebGLRenderer' : 'an unknown renderer');
}
