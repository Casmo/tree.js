// The promo video's output formats (scripts/promo-video/formats.mjs) and the camera framing per
// aspect ratio (scripts/promo-video/timeline.ts): the hero tree must fit every format.
import { describe, expect, it } from 'vitest';
import { FORMATS, parseFormats } from '../scripts/promo-video/formats.mjs';
import { framing, HERO_FRAME } from '../scripts/promo-video/timeline';

describe('promo video formats', () => {
  it('has a landscape, an Instagram (Reels, 9:16) and a LinkedIn (square) resolution', () => {
    expect(FORMATS.landscape).toEqual({ width: 1920, height: 1080, out: 'docs/promo/promo-video.mp4' });
    expect(FORMATS.instagram).toEqual({ width: 1080, height: 1920, out: 'docs/promo/promo-video-instagram.mp4' });
    expect(FORMATS.linkedin).toEqual({ width: 1080, height: 1080, out: 'docs/promo/promo-video-linkedin.mp4' });
  });

  it('writes every video to docs/promo/, the folder Git LFS tracks', () => {
    for (const format of Object.values(FORMATS)) expect(format.out).toMatch(/^docs\/promo\/promo-video[\w-]*\.mp4$/);
  });

  it('picks formats from --format (landscape by default, a list or all)', () => {
    expect(parseFormats(undefined)).toEqual(['landscape']);
    expect(parseFormats('instagram')).toEqual(['instagram']);
    expect(parseFormats('linkedin,instagram')).toEqual(['linkedin', 'instagram']);
    expect(parseFormats('all')).toEqual(['landscape', 'instagram', 'linkedin']);
    expect(() => parseFormats('tiktok')).toThrow(/tiktok.*landscape, instagram, linkedin/);
  });
});

describe('promo video framing', () => {
  /** Visible width and height (m) at the hero's distance for a framing and aspect ratio. */
  function visible(aspect: number) {
    const f = framing(aspect);
    const distance = Math.hypot(f.position[1] - f.target[1], f.position[2] - f.target[2]);
    const height = 2 * distance * Math.tan((f.fov * Math.PI) / 360);
    return { f, width: height * aspect, height };
  }

  it('keeps the landscape camera as it was', () => {
    const f = framing(16 / 9);
    expect(f.fov).toBe(36);
    expect(f.position).toEqual([0, 3.1, 16.5]);
    expect(f.target).toEqual([0, 3.75, 0]);
    expect(f.particleTop).toBe(12);
  });

  it.each([['instagram', 1080 / 1920], ['linkedin', 1], ['landscape', 16 / 9]])('fits the hero tree in %s', (_, aspect) => {
    const { width, height } = visible(aspect);
    expect(width).toBeGreaterThanOrEqual(HERO_FRAME.width - 1e-9);
    expect(height).toBeGreaterThanOrEqual(HERO_FRAME.height - 1e-9);
  });

  it('lets weather particles start above the top of a tall frame', () => {
    const { f, height } = visible(1080 / 1920);
    expect(f.particleTop).toBeGreaterThan(f.target[1] + height / 2);
  });
});
