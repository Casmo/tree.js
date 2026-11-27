// Output formats of the promo video (capture.mjs --format): plain JS so the Node capture script can
// import it; unit tested in test/promo-formats.test.ts.

/**
 * The resolutions the promo video is rendered at, with the default output file of each.
 * landscape: 16:9 Full HD (YouTube, the website, LinkedIn on desktop);
 * instagram: 9:16 (Reels and Stories, 1080x1920);
 * linkedin: 1:1 square (fills the most of the LinkedIn feed on both phone and desktop).
 * @type {Readonly<Record<'landscape' | 'instagram' | 'linkedin', { width: number; height: number; out: string }>>}
 */
export const FORMATS = Object.freeze({
  landscape: { width: 1920, height: 1080, out: 'promo-video.mp4' },
  instagram: { width: 1080, height: 1920, out: 'promo-video-instagram.mp4' },
  linkedin: { width: 1080, height: 1080, out: 'promo-video-linkedin.mp4' },
});

/**
 * The format names of a --format value: one name, a comma separated list or 'all' (landscape when absent).
 * @param {string | undefined} value
 * @returns {('landscape' | 'instagram' | 'linkedin')[]}
 */
export function parseFormats(value) {
  const names = Object.keys(FORMATS);
  if (value === undefined) return ['landscape'];
  if (value === 'all') return /** @type {any} */ (names);
  return value.split(',').map((name) => {
    if (!names.includes(name)) throw new Error(`Unknown format ${name}: use ${names.join(', ')} or all`);
    return /** @type {any} */ (name);
  });
}
