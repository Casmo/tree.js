export {};
declare global {
  interface Window {
    treeExample: {
      status: 'loading' | 'rendered' | 'error';
      backend?: string;
      error?: string;
      /** id of the leaf BufferGeometry, to check that Season does not regenerate. */
      leafGeometryId?: number;
      /** Sets `tree.season` and re-renders (status goes 'loading' -> 'rendered'). */
      setSeason?: (season: number) => void;
    };
  }
}
