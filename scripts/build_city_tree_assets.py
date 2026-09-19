"""Builds the placeable city tree family (DEV assets for the City Mapping Lab).

Sources, all from the city's own tileset (public/assets/tilesets/buildings.png):
  - the three forest trees already extracted to public/assets/town/tree-{a,b,c}.png
    (the forest keeps using those files, untouched);
  - two more trees of the same sheet the city never used: a golden (autumn) tree
    and a teal round tree.

For every tree the baked ground shadow is removed (its ring colours and the dark
core under the roots), keeping crown, trunk, roots and their outline: the ground
base is drawn separately on the terrain (worldAssets/trees/treeGroundBase.ts).

A few variants are derived by splicing whole bands of real pixels — never by
scaling, hue shifting or mirroring — so every pixel still comes from the sheet:
  - pointed-tall: one more tier of scales in the crown (a row band repeated);
  - pointed-slim: a central column band removed (narrower crown and roots);
  - round-wide:   a central column band repeated (broader crown and roots).

    python scripts/build_city_tree_assets.py

Writes src/features/worldAssets/trees/art/*.png and prints each size and part boxes,
which worldAssets/trees/cityTrees.ts freezes (and its tests check).
Pure Pillow, no numpy.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / 'public/assets/tilesets/buildings.png'
TOWN = ROOT / 'public/assets/town'
# Next to the asset module, not in public/: the PNGs only ship if something imports them.
OUT = ROOT / 'src/features/worldAssets/trees/art'


def hexes(*codes: str) -> set:
    return {tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in codes}


# Per source: baked-shadow ring colours, and trunk/root colours (what stays at ground level).
SOURCES = {
    'pointed': dict(shadow=hexes('#0e8951'), trunk=hexes('#8b6d45', '#9b7d4d', '#6f653c', '#574c34')),
    'pointed-lit': dict(shadow=hexes('#0e8951'), trunk=hexes('#8b6d45', '#9b7d4d', '#6f653c', '#574c34')),
    'round': dict(shadow=hexes('#53754c'), trunk=hexes('#605646', '#796546', '#9b7d4d')),
    'golden': dict(shadow=hexes('#4b7144'), trunk=hexes('#704f20', '#553e2b', '#966028', '#4a3e2b')),
    'teal': dict(shadow=hexes('#329b29', '#30b427', '#31a328', '#2fc438'), trunk=hexes('#483f2d', '#8e8574', '#d5ccc3', '#766d6d')),
}
# (x, y, w, h) in the sheet for the two trees the city does not use yet.
SHEET_TREES = {'golden': (58, 1327, 35, 50), 'teal': (99, 1426, 41, 49)}
OUTLINE = hexes('#333322', '#2c2c19', '#1d381d')
# Each source PNG ends its roots a few px above its bottom row (the loader's feet
# row): 4 for the pointed trees, 5 for the round one. Derived trees are padded to
# keep their source's exact lift, so the default anchor (w/2, h-1) stands them on
# the ground exactly like the forest trees.


def fill_seams(img: Image.Image) -> Image.Image:
    """Fills the sheet's 1px transparent grid seams from the left/upper neighbour (as extract_town_sprites.py)."""
    img = img.copy()
    px = img.load()
    w, h = img.size
    for _ in range(2):
        for y in range(h):
            for x in range(1, w - 1):
                if px[x, y][3] == 0 and px[x - 1, y][3] > 0 and px[x + 1, y][3] > 0:
                    px[x, y] = px[x - 1, y]
        for y in range(1, h - 1):
            for x in range(w):
                if px[x, y][3] == 0 and px[x, y - 1][3] > 0 and px[x, y + 1][3] > 0:
                    px[x, y] = px[x, y - 1]
    return img.crop(img.getbbox())


def strip_shadow(img: Image.Image, shadow: set, trunk: set) -> Image.Image:
    """Removes the baked ground shadow: its ring colours, and everything under the roots but their outline."""
    img = img.copy()
    px = img.load()
    w, h = img.size
    rgb = lambda x, y: px[x, y][:3]
    for y in range(h):
        for x in range(w):
            if px[x, y][3] and rgb(x, y) in shadow:
                px[x, y] = (0, 0, 0, 0)
    last = max(y for y in range(h) for x in range(w) if px[x, y][3] and rgb(x, y) in trunk)
    for y in range(last + 1, h):
        for x in range(w):
            if not px[x, y][3]:
                continue
            keep = y == last + 1 and rgb(x, y) in OUTLINE and px[x, y - 1][3] and rgb(x, y - 1) in trunk
            if not keep:
                px[x, y] = (0, 0, 0, 0)
    # Crown-coloured pixels left beside the roots on the ground rows are shadow core, not tree.
    top = min(y for y in range(h) for x in range(w) if px[x, y][3] and rgb(x, y) in trunk)
    xs = [x for y in range(top, last + 1) for x in range(w) if px[x, y][3] and rgb(x, y) in trunk]
    x0, x1 = min(xs) - 1, max(xs) + 1
    for y in range(top + 3, last + 1):
        for x in range(w):
            if px[x, y][3] and not (x0 <= x <= x1):
                px[x, y] = (0, 0, 0, 0)
    return img.crop(img.getbbox())


def repeat_rows(img: Image.Image, y0: int, y1: int) -> Image.Image:
    """Inserts a copy of rows [y0, y1) right after them."""
    w, h = img.size
    band = img.crop((0, y0, w, y1))
    out = Image.new('RGBA', (w, h + (y1 - y0)))
    out.paste(img.crop((0, 0, w, y1)), (0, 0))
    out.paste(band, (0, y1))
    out.paste(img.crop((0, y1, w, h)), (0, y1 + (y1 - y0)))
    return out


def repeat_cols(img: Image.Image, x0: int, x1: int) -> Image.Image:
    """Inserts a copy of columns [x0, x1) right after them."""
    w, h = img.size
    out = Image.new('RGBA', (w + (x1 - x0), h))
    out.paste(img.crop((0, 0, x1, h)), (0, 0))
    out.paste(img.crop((x0, 0, x1, h)), (x1, 0))
    out.paste(img.crop((x1, 0, w, h)), (x1 + (x1 - x0), 0))
    return out


def remove_cols(img: Image.Image, x0: int, x1: int) -> Image.Image:
    """Drops columns [x0, x1)."""
    w, h = img.size
    out = Image.new('RGBA', (w - (x1 - x0), h))
    out.paste(img.crop((0, 0, x0, h)), (0, 0))
    out.paste(img.crop((x1, 0, w, h)), (x0, 0))
    return out


def root_lift(img: Image.Image, trunk: set) -> int:
    """Rows between the lowest root pixel and the image's bottom row."""
    return img.size[1] - 1 - parts(img, trunk)['trunk'][3]


def settle_roots(img: Image.Image, trunk: set, lift: int) -> Image.Image:
    """Pads transparent rows at the bottom so the roots end `lift` px above the last row."""
    bottom = parts(img, trunk)['trunk'][3]
    w, h = img.size
    out = Image.new('RGBA', (w, bottom + 1 + lift))
    out.paste(img.crop((0, 0, w, min(h, bottom + 1 + lift))), (0, 0))
    return out


def parts(img: Image.Image, trunk: set) -> dict:
    px = img.load()
    w, h = img.size
    t = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] and px[x, y][:3] in trunk]
    return {'trunk': (min(x for x, _ in t), min(y for _, y in t), max(x for x, _ in t), max(y for _, y in t))}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEET).convert('RGBA')
    raw = {
        'pointed': Image.open(TOWN / 'tree-a.png').convert('RGBA'),
        'pointed-lit': Image.open(TOWN / 'tree-b.png').convert('RGBA'),
        'round': Image.open(TOWN / 'tree-c.png').convert('RGBA'),
    }
    for name, (x, y, w, h) in SHEET_TREES.items():
        raw[name] = fill_seams(sheet.crop((x, y, x + w, y + h)))
    lifts = {name: root_lift(img, SOURCES[name]['trunk']) for name, img in raw.items()}
    lifts.update({'pointed-tall': lifts['pointed'], 'pointed-slim': lifts['pointed'], 'round-wide': lifts['round']})
    trees = {name: strip_shadow(img, **SOURCES[name]) for name, img in raw.items()}
    # Derived silhouettes. Bands were chosen where the two edge rows/columns of
    # the splice match best (fewest differing pixels), so the join follows the
    # scale/leaf pattern instead of showing a seam.
    trees['pointed-tall'] = repeat_rows(trees['pointed'], 10, 16)
    trees['pointed-slim'] = remove_cols(trees['pointed'], 18, 23)
    trees['round-wide'] = repeat_cols(trees['round'], 18, 24)
    trunks = {**{k: SOURCES[k]['trunk'] for k in SOURCES},
              'pointed-tall': SOURCES['pointed']['trunk'], 'pointed-slim': SOURCES['pointed']['trunk'], 'round-wide': SOURCES['round']['trunk']}
    for name, img in trees.items():
        img = settle_roots(img, trunks[name], lifts[name])
        img.save(OUT / f'{name}.png')
        print(f'{name:14} size={img.size} lift={lifts[name]} {parts(img, trunks[name])}')


if __name__ == '__main__':
    main()
