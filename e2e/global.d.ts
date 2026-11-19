export {};
declare global {
  interface Window {
    treeExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      /** id of the leaf BufferGeometry, to check that Season does not regenerate. */
      leafGeometryId?: number;
      /** Vertex count of the tree's fruit mesh (0 without Fruit). */
      fruitVertices?: number;
      /** Sets `tree.season` and re-renders (status goes 'loading' -> 'rendered'). */
      setSeason?: (season: number) => void;
    };
  }
}
declare global {
  interface Window {
    forestExample: {
      status: 'loading' | 'rendered' | 'error';
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
    };
  }
}
