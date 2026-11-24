/**
 * Raster busts keyed by `data/portraits.json` id. The 896x1200 paintings in `art/portraits/`
 * are pre-sized by `tools/assets/portraits/build.py` into `art/portraits/sized/<file>-<w>.webp`
 * so the browser picks a copy near the shown size from `srcset` instead of shrinking the full
 * painting 10-20x itself, which some GPU paths do with a filter that leaves jagged outlines.
 */

const SIZED = import.meta.glob<string>('../../../art/portraits/sized/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const FILES: Record<string, string> = {
  'portrait.weathered': 'weathered',
  'portrait.young': 'young',
  'portrait.greybeard': 'greybeard',
  'portrait.mustache': 'mustache',
  'portrait.lumber': 'lumber',
  'portrait.captain': 'captain',
  'portrait.woman': 'woman',
  'portrait.woman_hat': 'woman_hat',
};

export interface PortraitImage {
  /** The largest copy, for browsers that ignore `srcset`. */
  src: string;
  /** Every pre-sized copy as `url <w>w`, smallest first. */
  srcset: string;
}

const IMAGES = new Map<string, PortraitImage>();
for (const [id, file] of Object.entries(FILES)) {
  const sized = Object.entries(SIZED)
    .map(([path, url]) => {
      const m = path.match(/\/([^/]+)-(\d+)\.webp$/);
      return m?.[1] === file ? { w: Number(m[2]), url } : undefined;
    })
    .filter((s): s is { w: number; url: string } => s !== undefined)
    .sort((a, b) => a.w - b.w);
  const largest = sized.at(-1);
  if (!largest) continue;
  IMAGES.set(id, { src: largest.url, srcset: sized.map((s) => `${s.url} ${s.w}w`).join(', ') });
}

export function portraitImage(id: string): PortraitImage | undefined {
  return IMAGES.get(id);
}
