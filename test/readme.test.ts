// The README's code must match the real public API: every ```ts / ```tsx block is type-checked
// against the package entry points (`@casmo/tree.js`, `/react`, `/effects`, `/styles/<name>`,
// resolved to src/ via tsconfig `paths`) as if it were a module in a user's app.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

interface Snippet {
  line: number;
  lang: 'ts' | 'tsx';
  code: string;
}

function snippets(markdown: string): Snippet[] {
  const found: Snippet[] = [];
  const fence = /^```(tsx?)\n([\s\S]*?)^```$/gm;
  for (const match of markdown.matchAll(fence)) {
    const line = markdown.slice(0, match.index).split('\n').length;
    found.push({ line, lang: match[1] as 'ts' | 'tsx', code: match[2]! });
  }
  return found;
}

/**
 * What a snippet may use without declaring it: the objects every three.js app already has.
 * Snippets that create their own `renderer`/`scene`/`camera` shadow these (they are modules).
 */
const AMBIENT = `
import type * as THREE from 'three/webgpu';
declare global {
  const renderer: THREE.WebGPURenderer;
  const scene: THREE.Scene;
  const camera: THREE.PerspectiveCamera;
}
export {};
`;

function typeCheck(list: Snippet[]): string[] {
  const configFile = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  options.noEmit = true;
  options.moduleDetection = ts.ModuleDetectionKind.Force;
  options.noUnusedLocals = false;

  const files = new Map<string, string>();
  files.set(resolve(root, 'readme-snippets/ambient.d.ts'), AMBIENT);
  const names = list.map((s) => {
    const name = resolve(root, `readme-snippets/line-${s.line}.${s.lang}`);
    files.set(name, s.code);
    return name;
  });

  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) => {
    const text = files.get(resolve(name));
    return text === undefined ? getSourceFile(name, version, ...rest) : ts.createSourceFile(name, text, version);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => files.has(resolve(name)) || fileExists(name);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => files.get(resolve(name)) ?? readFile(name);

  const program = ts.createProgram([...files.keys()], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && files.has(resolve(d.file.fileName)))
    .map((d) => {
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      const snippetLine = Number(/line-(\d+)/.exec(d.file!.fileName)![1]);
      return `README.md:${snippetLine + 1 + line}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    })
    .concat(names.length === 0 ? ['README.md has no ts/tsx snippets'] : []);
}

describe('README', () => {
  it('has TypeScript snippets', () => {
    expect(snippets(readme).length).toBeGreaterThan(5);
  });

  it('only shows code that type-checks against the published API', () => {
    expect(typeCheck(snippets(readme))).toEqual([]);
  }, 60_000);

  it('covers every topic of the docs', () => {
    const headings = [...readme.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]!.toLowerCase());
    for (const topic of ['install', 'webgpurenderer', 'styles', 'growth', 'season', 'wind', 'forest', 'tree effects', 'react three fiber', 'import map']) {
      expect(headings.some((h) => h.includes(topic)), `a heading about "${topic}"`).toBe(true);
    }
  });

  it('shows the same import map as the tested CDN example', () => {
    const importMap = (html: string) => JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!);
    const example = readFileSync(resolve(root, 'examples/cdn/index.html'), 'utf8');
    expect(importMap(readme)).toEqual(importMap(example));
  });
});
