import type { WindBurstOptions } from "@casmo/tree.js";
import type { WetnessSettings } from "@casmo/tree.js/weather";

export {};
declare global {
  interface Window {
    treeExample: {
      status: "loading" | "rendered" | "error";
      backend?: string;
      error?: string;
      /** id of the leaf BufferGeometry, to check that Season does not regenerate. */
      leafGeometryId?: number;
      /** Vertex count of the tree's fruit mesh (0 without Fruit). */
      fruitVertices?: number;
      /** Sets `tree.season` and re-renders (status goes 'loading' -> 'rendered'). */
      setSeason?: (season: number) => void;
      /** With ?burst=1: world-space ground points of the near (left) and far (right) tree. */
      trees?: { near: [number, number]; far: [number, number] };
      /** Starts a Wind Burst on the scene-wide Wind (at its current time) and draws the frame again. */
      burst?: (options: WindBurstOptions) => Promise<void>;
      /** Pins the scene-wide Wind clock to `seconds` and draws the frame again. */
      setWindTime?: (seconds: number) => Promise<void>;
      /** Sets the magenta Tree Shader Hook on these parts only (none: removes them) and re-renders. */
      setShaderHooks?: (parts: string[]) => void;
      /** Shows or hides one part's mesh ('wood', 'leaves', 'fruit') and re-renders. */
      setVisible?: (mesh: string, visible: boolean) => void;
      /** With ?wetness: sets the scene-wide wetness amount, Wetness's settings, and whether its hooks are set, then draws again. */
      setWetness?: (options: { amount?: number; hooks?: boolean; settings?: WetnessSettings }) => Promise<void>;
    };
  }
}
declare global {
  interface Window {
    forestExample: {
      status: "loading" | "rendered" | "error";
      backend?: string;
      error?: string;
      trees?: number;
      drawCalls?: number;
      /** Fruit instances drawn over all Variants (0 without Fruit). */
      fruitInstances?: number;
      /** Roots in the Variant with the fewest (0 without a `roots` block). */
      roots?: number;
      /** With ?lod: trees drawn at each Detail Level by the GPU (a tree in a cross-fade counts at both). */
      levels?: { full: number; light: number; impostor: number };
      /** With ?lod: the same counts from the CPU's selectDetailLevel. */
      expectedLevels?: { full: number; light: number; impostor: number };
      /** Draws the frame again (the page is otherwise still), resolving once it is drawn. */
      renderAgain?: () => Promise<void>;
      /** With ?lod: sets the Growth of the whole forest, draws it and updates `levels` and `expectedLevels`. */
      setGrowth?: (growth: number) => Promise<void>;
      /** Tunes the forest's live Material Features (only those that are on), then draws the frame again. */
      setMaterialFeatures?: (features: {
        crownNormals?: number;
        translucency?: { strength?: number; edge?: number; ambient?: number };
        occlusionStrength?: number;
      }) => Promise<void>;
      /** Sets the magenta Tree Shader Hook on the forest's / the scene-wide parts and its amount, then draws again. */
      setShaderHooks?: (options: { parts?: string[]; sceneParts?: string[]; amount?: number }) => Promise<void>;
      /** Starts a Wind Burst on the scene-wide Wind (at its current time) and draws the frame again. */
      burst?: (options: { x: number; z: number; strength?: number; radius?: number }) => Promise<void>;
      /** Pins the scene-wide Wind clock to `seconds` and draws the frame again. */
      setWindTime?: (seconds: number) => Promise<void>;
    };
  }
}
declare global {
  interface Window {
    largeForestExample: {
      /** 'loading' while the Forest is built, baked or measured. */
      status: "loading" | "rendered" | "error";
      backend?: string;
      error?: string;
      trees?: number;
      /** Whether the current Forest has Detail Levels. */
      lod?: boolean;
      /** The last run of each kind. */
      runs?: { off?: LargeForestRun; on?: LargeForestRun };
      /** Rebuilds the Forest with or without Detail Levels and measures it (status 'loading' until done). */
      setLod?: (lod: boolean) => Promise<void>;
    };
  }
}
/** One measured run of examples/large-forest (the same shape as its `Run`). */
interface LargeForestRun {
  lod: boolean;
  frameTime: { frames: number; average: number; p95: number };
  drawCalls: number;
  triangles: number;
  levels: { full: number; light: number; impostor: number };
}
