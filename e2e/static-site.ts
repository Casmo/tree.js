import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { test, type Page } from '@playwright/test';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
};

/**
 * Serves the page's requests from local files, without Vite (so nothing is transformed), the way a
 * static host or CDN would: `sites` maps URL prefixes to directories. Every other request is a 404
 * (nothing reaches the network). Returns the list of requested URLs.
 */
export async function serveStatic(page: Page, sites: Record<string, string>): Promise<string[]> {
  const requested: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    requested.push(url);
    const prefix = Object.keys(sites).find((p) => url.startsWith(p));
    let file = prefix ? join(sites[prefix]!, decodeURIComponent(new URL(url).pathname.slice(new URL(prefix).pathname.length))) : undefined;
    if (file && existsSync(file) && statSync(file).isDirectory()) file += '/index.html';
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: `not found: ${url}` });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  return requested;
}

/** Skips locally when a build output is missing (CI builds it before the e2e tests, so there it must exist). */
export function requireBuild(path: string, command: string): void {
  test.skip(!existsSync(path) && !process.env.CI, `run \`${command}\` first`);
}
