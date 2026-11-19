import { describe, expect, it } from 'vitest';
import { vec4 } from 'three/tsl';
import { Color, PerspectiveCamera, Scene, Texture, type Node, type Renderer } from 'three/webgpu';
import { applySceneEffects, createScenePipeline, sceneFog, SUGGESTED_SCENE_EFFECTS, type ScenePipelineOptions } from '../../src/scene';

const renderer = { isWebGPURenderer: true } as unknown as Renderer;
const appFog = vec4(1, 0, 0, 1) as unknown as Node;
const sceneWithAppFog = () => Object.assign(new Scene(), { fogNode: appFog });
const create = (scene: Scene, options?: ScenePipelineOptions) => createScenePipeline(renderer, scene, new PerspectiveCamera(), options);

describe('sceneFog', () => {
  it('returns a fog node with every number and colour as a uniform', () => {
    const fog = sceneFog();
    expect(fog.isNode).toBe(true);
    expect(sceneFog({ near: 2, far: 30, color: '#ffffff', mist: { height: 2, strength: 0.5, farLayer: { near: 20, far: 90, strength: 0.4 } } }).isNode).toBe(true);
  });

  it('takes its colour from a plain-colour background, else the setting, and an explicit colour wins', () => {
    const colorOf = (fog: Node) => uniformColors(fog).map((c) => c.getHexString());
    expect(colorOf(sceneFog({}, new Color('#123456')))).toEqual(['123456']);
    expect(colorOf(sceneFog({ color: '#abcdef' }, new Texture()))).toEqual(['abcdef']);
    expect(colorOf(sceneFog({ color: '#abcdef' }, new Color('#123456')))).toEqual(['abcdef']);
    expect(colorOf(sceneFog({}, null))).toHaveLength(1);
  });
});

describe('fog in SUGGESTED_SCENE_EFFECTS', () => {
  it('is distance fog for low-poly, plus a height mist for stylized and realistic', () => {
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].fog).toBeDefined();
    expect(SUGGESTED_SCENE_EFFECTS['low-poly'].fog?.mist ?? null).toBeNull();
    expect(SUGGESTED_SCENE_EFFECTS.stylized.fog?.mist).toBeDefined();
    expect(SUGGESTED_SCENE_EFFECTS.realistic.fog?.mist).toBeDefined();
    // The stylized mist stays low: below the realistic one.
    expect(SUGGESTED_SCENE_EFFECTS.stylized.fog!.mist!.height!).toBeLessThan(SUGGESTED_SCENE_EFFECTS.realistic.fog!.mist!.height!);
  });

  it('is not a colour step: applySceneEffects leaves the colour to the scene pass', () => {
    const input = { color: vec4(0.2, 0.4, 0.1, 1) };
    expect(applySceneEffects(input, { fog: {} })).toBe(input.color);
  });
});

describe('ScenePipeline fog: the only scene change, restored', () => {
  it('leaves scene.fogNode alone without fog', () => {
    const scene = sceneWithAppFog();
    create(scene, { sceneEffects: { toneMapping: {} } });
    expect(scene.fogNode).toBe(appFog);
    const empty = new Scene();
    create(empty);
    expect(empty.fogNode).toBeUndefined();
  });

  it("sets scene.fogNode with fog and restores the app's value on dispose()", () => {
    const scene = sceneWithAppFog();
    const pipeline = create(scene, { style: 'realistic' });
    expect(scene.fogNode).not.toBe(appFog);
    expect(scene.fogNode).not.toBeNull();
    pipeline.dispose();
    expect(scene.fogNode).toBe(appFog);
  });

  it("restores the app's value when fog is switched off with set(), and takes it over again when switched on", () => {
    const scene = sceneWithAppFog();
    const pipeline = create(scene, { style: 'stylized' });
    pipeline.set({ style: 'stylized', sceneEffects: { ...SUGGESTED_SCENE_EFFECTS.stylized, fog: undefined } });
    expect(scene.fogNode).toBe(appFog);
    pipeline.set({ sceneEffects: null });
    expect(scene.fogNode).toBe(appFog);
    pipeline.set({ style: 'low-poly' });
    expect(scene.fogNode).not.toBe(appFog);
    pipeline.dispose();
    expect(scene.fogNode).toBe(appFog);
  });

  it('restores no fog node when the app had none', () => {
    const scene = new Scene();
    create(scene, { style: 'low-poly' }).dispose();
    expect(scene.fogNode).toBeUndefined();
  });

  it('keeps the same fog node when only fog numbers and colours change (no material recompile)', () => {
    const scene = new Scene();
    const pipeline = create(scene, { sceneEffects: { fog: { near: 5, far: 40 } } });
    const node = scene.fogNode;
    pipeline.set({ sceneEffects: { fog: { near: 8, far: 60, color: '#ffffff', mist: { height: 3 } } } });
    expect(scene.fogNode).toBe(node);
    expect(uniformColors(node!).map((c) => c.getHexString())).toEqual(['ffffff']);
  });

  it("does not overwrite a fog node the app assigned while the pipeline's fog was on", () => {
    const scene = new Scene();
    const pipeline = create(scene, { style: 'realistic' });
    scene.fogNode = appFog;
    pipeline.dispose();
    expect(scene.fogNode).toBe(appFog);
  });
});

/** The values of the Color uniforms in a graph. */
function uniformColors(root: Node): Color[] {
  const seen = new Set<Node>();
  const found: Color[] = [];
  const visit = (node: Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const uniform = node as unknown as { isUniformNode?: boolean; value?: unknown };
    if (uniform.isUniformNode && uniform.value instanceof Color) found.push(uniform.value);
    for (const child of node.getChildren()) visit(child as Node);
  };
  visit(root);
  return found;
}
