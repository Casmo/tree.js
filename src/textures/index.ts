import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three/webgpu';

/**
 * Where the package's own textures live, relative to this module: `./textures/` next to the
 * built `dist/index.js` (copied from `assets/` by the build), `../../assets/textures/` from
 * `src/textures/` in dev and tests. Set by `define` in vite.config.ts.
 */
declare const __TREE_TEXTURES_DIR__: string;
// Unbundled (e.g. Playwright specs importing the sources in Node) there is no define: the source layout.
const TEXTURES_DIR: string = typeof __TREE_TEXTURES_DIR__ === 'string' ? __TREE_TEXTURES_DIR__ : '../../assets/textures/';
// Not written as `new URL('<literal>', import.meta.url)` on purpose: app bundlers (Vite, webpack)
// rewrite that pattern as an asset import, but this is a directory the app may host elsewhere.
const MODULE_URL: string = import.meta.url;

/**
 * The URL of the package's bundled textures (the realistic Style's bark and leaf cards), as
 * shipped in `dist/textures/`. Relative texture URLs in a Definition resolve against it unless
 * the app sets its own `basePath`.
 */
export const DEFAULT_TEXTURE_BASE_PATH: string = new URL(TEXTURES_DIR, MODULE_URL).href;

/**
 * Where tree textures are loaded from. Texture URLs in a Tree Definition (`materials.bark.map`,
 * `materials.bark.normalMap`, `materials.leaf.map`) are either absolute (`https://…`, `/…`,
 * `data:`, `blob:`), used as they are, or relative (`realistic/bark.png`), resolved against
 * `basePath`.
 */
export interface TextureOptions {
  /**
   * Base path or URL for relative texture URLs, e.g. `'https://cdn.example.com/tree-textures/'`
   * after copying `node_modules/@casmo/tree.js/dist/textures/` there. Default: the package's own
   * `dist/textures/` (`DEFAULT_TEXTURE_BASE_PATH`).
   */
  basePath?: string;
  /** Per-texture overrides, keyed by the URL as written in the Definition (e.g. `'realistic/bark.png'`). */
  urls?: Record<string, string>;
}

let globalOptions: TextureOptions = {};

/**
 * Sets the app-wide texture options (base path / URL overrides) used by every tree created
 * afterwards. Options passed to `createTree(…, { textures })` take precedence.
 */
export function setTextureOptions(options: TextureOptions): void {
  globalOptions = { ...options, urls: { ...options.urls } };
}

/** The app-wide texture options set with `setTextureOptions`. */
export function getTextureOptions(): TextureOptions {
  return { ...globalOptions, urls: { ...globalOptions.urls } };
}

const ABSOLUTE = /^([a-z][a-z\d+.-]*:|\/)/i;

/** The URL a Definition's texture URL is loaded from, after URL overrides and the base path. */
export function resolveTextureUrl(url: string, options: TextureOptions = {}): string {
  const override = options.urls?.[url] ?? globalOptions.urls?.[url];
  if (override !== undefined) return override;
  if (ABSOLUTE.test(url)) return url;
  const base = options.basePath ?? globalOptions.basePath ?? DEFAULT_TEXTURE_BASE_PATH;
  return (base === '' || base.endsWith('/') ? base : `${base}/`) + url.replace(/^\.\//, '');
}

/** What a texture holds: colour (sRGB) or data such as a normal map (linear). */
export type TextureKind = 'color' | 'data';

const cache = new Map<string, Texture>();
const pending = new WeakMap<Texture, Promise<void>>();

/**
 * Loads a texture from an already resolved URL. Textures are shared: the same URL and kind
 * give the same `Texture` (trees don't dispose them). `texture.name` is the URL. The image
 * loads asynchronously; `textureReady(texture)` resolves once it is there. Outside a browser
 * (no DOM, e.g. Node tests) the texture is created without an image.
 */
export function loadTexture(url: string, kind: TextureKind): Texture {
  const key = `${kind} ${url}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let texture: Texture;
  let ready: Promise<void>;
  if (typeof document === 'undefined') {
    texture = new Texture();
    ready = Promise.resolve();
  } else {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    ready = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
    texture = new TextureLoader().load(url, () => resolve(), undefined, () => {
      cache.delete(key);
      reject(new Error(`tree.js: could not load texture ${url}`));
    });
    ready.catch(() => {}); // reported through `textureReady` / `tree.ready`, not as unhandled
  }
  texture.name = url;
  texture.colorSpace = kind === 'color' ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  cache.set(key, texture);
  pending.set(texture, ready);
  return texture;
}

/** Resolves when a texture from `loadTexture` has its image (rejects if it failed to load). */
export function textureReady(texture: Texture): Promise<void> {
  return pending.get(texture) ?? Promise.resolve();
}
