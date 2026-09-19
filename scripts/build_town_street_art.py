"""Builds the town's fence pieces into public/assets/town.

They come from the picket fence block of public/assets/tilesets/buildings.png
(a sample enclosure with 1 px seams). The sheet's straight piece only joins its
own two pickets with the lower rail, so a run looked like pairs, and its
vertical crop carried a sliver of another post. Here:

    fence-h              straight run: two pickets, both rails continuous
    fence-corner-left    the run starts at its left picket (no rail beyond it)
    fence-corner-right   the run ends at its right picket
    fence-post           one post of a vertical run, standing upright

A vertical run is not one sprite per tile: the town stands a post every 8 px
at its own spot on the ground (two per tile), so the tilted camera spaces
them like the ground and the posts in front cover the ones behind. Corners
join a row and a column through the corner picket (TownArea autotiles).

    python scripts/build_town_street_art.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / 'public/assets/tilesets/buildings.png'
OUT = ROOT / 'public/assets/town'

CLEAR = (0, 0, 0, 0)
FENCE_BLOCK = (256, 956)       # top-left of the fence block in the sheet

# Fence colours (the sheet's own).
FENCE = {
    'A': (225, 225, 200, 255),  # picket light
    'B': (229, 240, 249, 255),  # picket top
    'C': (170, 170, 153, 255),  # picket body
    'D': (104, 104, 121, 255),  # rail / shade
}
LEFT_POST, RIGHT_POST = 2, 10  # picket columns inside a 16 px tile


def paint(rows: list[str], colours: dict, x0: int = 0, y0: int = 0, img: Image.Image | None = None) -> Image.Image:
    if img is None:
        img = Image.new('RGBA', (max(len(r) for r in rows), len(rows)), CLEAR)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in colours and 0 <= x0 + x < img.width and 0 <= y0 + y < img.height:
                img.putpixel((x0 + x, y0 + y), colours[ch])
    return img


def fence_h(sheet: Image.Image) -> Image.Image:
    fx, fy = FENCE_BLOCK
    img = Image.new('RGBA', (16, 16), CLEAR)
    img.alpha_composite(sheet.crop((fx + 17, fy, fx + 33, fy + 14)), (0, 2))  # middle tile of the top row
    for y in (13, 14):                                                        # lower rail across the tile edges
        for x in (0, 1, 14, 15):
            img.putpixel((x, y), FENCE['D'])
    return img


def fence_post() -> Image.Image:
    """One upright post: the sheet's post head on top of a shaft as tall as the pickets."""
    return paint(['CAAC', 'ABBA', 'AAAA', 'ACCAD', 'CCCCD', 'CCCCDD', 'CCCCDD'] + ['CCCCD'] * 6 + ['DDDD'], FENCE, img=Image.new('RGBA', (6, 14), CLEAR))


def fence_corner(straight: Image.Image, left: bool) -> Image.Image:
    """The corner picket closes the run: no rail past it."""
    img = straight.copy()
    for x in (range(0, LEFT_POST) if left else range(RIGHT_POST + 4, 16)):
        for y in range(16):
            img.putpixel((x, y), CLEAR)
    return img


def main() -> None:
    sheet = Image.open(SHEET).convert('RGBA')
    straight = fence_h(sheet)
    pieces = {
        'fence-h': straight,
        'fence-corner-left': fence_corner(straight, left=True),
        'fence-corner-right': fence_corner(straight, left=False),
        'fence-post': fence_post(),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    for name, img in pieces.items():
        img.save(OUT / f'{name}.png')
        print(f'{name:18} {img.size}')


if __name__ == '__main__':
    main()
