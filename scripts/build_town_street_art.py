"""Builds the town's fences and plaza benches into public/assets/town.

Fences come from the picket fence block of public/assets/tilesets/buildings.png
(a sample enclosure with 1 px seams). The sheet's straight piece only joins its
own two pickets with the lower rail, so a run looked like pairs; its vertical
crop carried a sliver of another post; and its corner posts were never cut.
Here every piece is a full 16 px tile, so the town can autotile them:

    fence-h                    straight run, both rails continuous
    fence-v / fence-v-right    vertical run, posts under the left / right picket
    fence-nw / -ne             corner: the run turns DOWN from this tile
    fence-sw / -se             corner: the run arrives from ABOVE

The sheet has no bench (the pieces used before were dirt ramps). The benches
follow Hearthome City's in Platinum: two red planks, a raised backrest strip on
one side, iron brackets, and a long bench split in two seats.

    bench-long / bench-long-left    1×3 tiles, backrest right / left
    bench-short                     1×2 tiles, backrest right
    bench-across                    2×1 tiles, facing down

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
# One post head of a vertical run, as the sheet's left column draws it; 8 px apart.
POST_HEAD = ['CAAC', 'ABBA', 'AAAA', 'ACCAD', 'CCCCDD', 'CCCCDD', 'CCCCD', 'CCCC']
LEFT_POST, RIGHT_POST = 2, 10  # picket columns inside a 16 px tile

# Bench colours and rows (one row per pixel row, left to right; backrest on the right).
BENCH = {
    'O': (64, 54, 44, 255),     # outline
    'K': (176, 80, 72, 255),    # plank
    'L': (172, 66, 56, 255),    # plank, groove
    'M': (144, 66, 46, 255),    # plank, dark
    'J': (130, 64, 54, 255),    # shade under the backrest
    'H': (204, 106, 90, 255),   # backrest
    'U': (92, 22, 16, 255),     # iron
    'S': (40, 30, 24, 90),      # soft ground shadow
}
BENCH_TOP = ['         OOOO'] + ['         OHHO'] * 4 + ['OOOOOOOOOJHHO']
SEAT = 'OKLMKKMLKJHHO'
BRACKET = 'OKLMKKMLKUUUO'
SPLIT = ['OUUUUUUUUJHHO', 'OUUUUUUUUJHHO', 'OUUOOOOOOJHHO', 'OUO......OHHO', 'OKLOOOOOOJHHO']
BENCH_END = ['OUUUUUUUUUUUO', 'OUUOOOOOOUUOO', 'OUO......OO..', 'OUOSSSSSSUO..', 'SSS......SSS.']


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


def fence_v(post: int) -> Image.Image:
    return paint(POST_HEAD + POST_HEAD, FENCE, x0=post, img=Image.new('RGBA', (16, 16), CLEAR))


def fence_corner(straight: Image.Image, down: bool, left: bool) -> Image.Image:
    img = straight.copy()
    post = LEFT_POST if left else RIGHT_POST
    for x in (range(0, post) if left else range(post + 4, 16)):               # no rail past the corner post
        for y in range(16):
            img.putpixel((x, y), CLEAR)
    if down:   # the corner post keeps going down, as the sheet's top-left post does
        paint(['CAAC', 'ABBA', 'AAAA', 'ACCAD', 'CCCCDD', 'CCCCDD', 'CCCCD'], FENCE, x0=post, y0=9, img=img)
    else:      # the run arrives from above: the shaft fills the rows over the picket
        paint(['CCCCD', 'CCCCD', 'CAAC', 'ABBA', 'ACCAD'], FENCE, x0=post, img=img)
    return img


def bench_long() -> Image.Image:
    return paint(BENCH_TOP + [SEAT] * 15 + [BRACKET] * 4 + [SEAT] + SPLIT + [SEAT] * 14 + [BRACKET] * 6 + BENCH_END, BENCH)


def bench_short() -> Image.Image:
    return paint(BENCH_TOP + [SEAT] * 13 + [BRACKET] * 6 + BENCH_END, BENCH)


def bench_across(width: int = 30) -> Image.Image:
    inner = width - 2
    rows = [' ' + 'O' * inner + ' '] + ['O' + 'H' * inner + 'O'] * 4 + ['O' + 'J' * inner + 'O']
    rows += ['O' + c * inner + 'O' for c in 'KLMKKMLK']
    rows += [
        'O' + 'U' * inner + 'O',
        'OUUO' + 'O' * (inner - 6) + 'OUUO',
        'OUO.' + '.' * (inner - 6) + '.OUO',
        'OUO' + 'S' * (inner - 4) + 'OUO',
        'SSS' + '.' * (inner - 4) + 'SSS',
    ]
    img = paint(rows, BENCH)
    for x in (3, 4, width - 5, width - 4):                                    # iron brackets through the backrest
        for y in range(1, 6):
            img.putpixel((x, y), BENCH['U'])
    return img


def main() -> None:
    sheet = Image.open(SHEET).convert('RGBA')
    straight = fence_h(sheet)
    pieces = {
        'fence-h': straight,
        'fence-v': fence_v(LEFT_POST),
        'fence-v-right': fence_v(RIGHT_POST),
        'fence-nw': fence_corner(straight, down=True, left=True),
        'fence-ne': fence_corner(straight, down=True, left=False),
        'fence-sw': fence_corner(straight, down=False, left=True),
        'fence-se': fence_corner(straight, down=False, left=False),
        'bench-long': bench_long(),
        'bench-long-left': bench_long().transpose(Image.FLIP_LEFT_RIGHT),
        'bench-short': bench_short(),
        'bench-across': bench_across(),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    for name, img in pieces.items():
        img.save(OUT / f'{name}.png')
        print(f'{name:16} {img.size}')


if __name__ == '__main__':
    main()
