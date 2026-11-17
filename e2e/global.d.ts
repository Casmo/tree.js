export {};
declare global {
  interface Window {
    treeExample: { status: 'loading' | 'rendered' | 'error'; backend?: string; error?: string };
  }
}
