"""Extracts WildLands town sprites from public/assets/tilesets/buildings.png.

Pieces are located by their bounding box in the sheet (found by segmenting
opaque regions), tightly cropped, and 1px transparent seams left by the
sheet's tile grid are filled from neighbouring pixels.

    python scripts/extract_town_sprites.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / 'public/assets/tilesets/buildings.png'
OUT = ROOT / 'public/assets/town'

# name: (x, y, w, h) in the sheet
PIECES = {
    'pokecenter': (31, 1, 84, 77),
    'mart': (140, 15, 65, 56),
    'house-green': (28, 202, 70, 75),
    'house-blue': (139, 202, 70, 75),
    'apartment-a': (795, 174, 76, 123),
    'apartment-b': (609, 174, 96, 125),
    'gym': (487, 1164, 130, 96),
    'poffin': (20, 493, 86, 95),
    'contest': (128, 440, 114, 144),
    'fanclub': (169, 331, 75, 90),
    'amity-gate': (515, 37, 96, 116),
    'route-gate': (435, 181, 84, 108),
    'tree-a': (125, 1318, 41, 51),
    'tree-b': (268, 1318, 41, 51),
    'tree-c': (195, 1321, 43, 48),
    'hedge': (225, 958, 14, 14),
    'lamp': (705, 113, 18, 37),
    'sign': (240, 922, 18, 20),
    'bench-a': (187, 1013, 16, 33),
    'bench-b': (213, 1013, 16, 33),
    'fountain-a': (835, 27, 60, 52),
    'fountain-b': (904, 27, 60, 52),
    'fountain-c': (974, 27, 60, 52),
}
FENCE = (256, 956, 50, 51)


def fill_seams(img: Image.Image) -> Image.Image:
    """Fills 1px transparent gaps sandwiched between opaque pixels."""
    a = np.array(img)
    for _ in range(2):
        alpha = a[:, :, 3]
        gap = alpha == 0
        horiz = np.zeros_like(gap)
        horiz[:, 1:-1] = gap[:, 1:-1] & (alpha[:, :-2] > 0) & (alpha[:, 2:] > 0)
        vert = np.zeros_like(gap)
        vert[1:-1, :] = gap[1:-1, :] & (alpha[:-2, :] > 0) & (alpha[2:, :] > 0)
        src = np.roll(a, 1, axis=1)
        a[horiz] = src[horiz]
        src = np.roll(a, 1, axis=0)
        a[vert & (a[:, :, 3] == 0)] = src[vert & (a[:, :, 3] == 0)]
    return Image.fromarray(a)


def tight(img: Image.Image) -> Image.Image:
    box = img.getbbox()
    return img.crop(box) if box else img


def patch_floor_hole(img: Image.Image, shift: int) -> Image.Image:
    """Fills interior transparent pixels by copying the floor `shift` px to the left."""
    a = np.array(img)
    h, w = a.shape[:2]
    for y in range(8, h - 8):
        for x in range(shift, w - 8):
            if a[y, x, 3] == 0 and a[y, x - shift, 3] > 0:
                a[y, x] = a[y, x - shift]
    return Image.fromarray(a)


# The Amity gate's floor has a missing patch in the sheet.
PATCHES = {'amity-gate': lambda img: patch_floor_hole(img, 48)}


def main() -> None:
    sheet = Image.open(SHEET).convert('RGBA')
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (x, y, w, h) in PIECES.items():
        piece = tight(fill_seams(sheet.crop((x, y, x + w, y + h))))
        if name in PATCHES:
            piece = PATCHES[name](piece)
        piece.save(OUT / f'{name}.png')
        print(f'{name:14} {piece.size}')
    fx, fy, fw, fh = FENCE
    fence = sheet.crop((fx, fy, fx + fw, fy + fh))
    tight(fence.crop((17, 0, 33, 17))).save(OUT / 'fence-h.png')
    tight(fence.crop((0, 17, 16, 34))).save(OUT / 'fence-v.png')
    print('fence-h / fence-v')


if __name__ == '__main__':
    main()
