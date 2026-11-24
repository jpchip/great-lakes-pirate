"""Pre-size the captain portraits for the menus.

The busts in `art/portraits/` are 896x1200 paintings, but the game shows them 44 to 112
CSS pixels wide. Left to the browser, that is a 10-20x downscale, and some GPU paths
(hardware raster without mipmaps) sample it with a plain bilinear filter, which drops
most source pixels and leaves stair-stepped outlines. This writes Lanczos-filtered WebP
copies at the widths the menus need so the browser never shrinks one by more than ~1.5x;
`src/ui/menu/portrait-assets.ts` offers them through `srcset`.

Run from the repo root after adding or repainting a portrait (needs Pillow):

    python3 tools/assets/portraits/build.py
"""

from pathlib import Path

from PIL import Image

SRC = Path('art/portraits')
OUT = SRC / 'sized'
# Covers 44/52/112 CSS px at 1x, 2x and 3x screens (see Portrait.tsx).
WIDTHS = (64, 128, 192, 256, 384)
QUALITY = 88


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for stale in OUT.glob('*.webp'):
        stale.unlink()
    for path in sorted(SRC.glob('*.png')):
        with Image.open(path) as im:
            im = im.convert('RGB')
            for w in WIDTHS:
                h = round(w * im.height / im.width)
                small = im.resize((w, h), Image.Resampling.LANCZOS, reducing_gap=3.0)
                dest = OUT / f'{path.stem}-{w}.webp'
                small.save(dest, 'WEBP', quality=QUALITY, method=6)
                print(f'{dest}  {w}x{h}  {dest.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
