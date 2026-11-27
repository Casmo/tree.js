// Types of formats.mjs (plain JS for the Node capture script), for main.ts' tests.
export type FormatName = 'landscape' | 'instagram' | 'linkedin';
export declare const FORMATS: Readonly<Record<FormatName, { width: number; height: number; out: string }>>;
export declare function parseFormats(value: string | undefined): FormatName[];
