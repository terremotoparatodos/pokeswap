"""Renders a converted town model with the WildLands handheld camera, for review.

Three shots: the model left of the screen centre, centred and right of it (so
the side walls show), side by side and magnified, next to an optional sprite:

    python scripts/preview_town_model.py public/assets/town/models/pokecenter.json out.png [sprite.png]

Same maths as engine/projection.ts and engine/townModel.ts, drawn per pixel
with a depth buffer (the game sorts triangles instead; the result matches for
these closed, low-poly models).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

LENS = {'zoom': 1.0, 'squash': 0.74, 'distance': 900.0}
GROUND = (196, 170, 128, 255)


def render(model_path: Path, offset: float, width=460, height=170, background=GROUND) -> Image.Image:
    data = json.loads(model_path.read_text(encoding='utf-8'))
    textures = [Image.open(model_path.parent / m['texture']).convert('RGBA') for m in data['materials']]
    D, f = LENS['distance'], LENS['zoom'] * LENS['distance']
    h = LENS['squash'] * D
    cx, horizon = width / 2, height * 0.9 - LENS['zoom'] * LENS['squash'] * D
    img = Image.new('RGBA', (width, height), background)
    px = img.load()
    zbuf = [[1e18] * width for _ in range(height)]

    def project(v):
        x, y, z = v
        depth = D - (z - data['front'])
        return cx + f * (x - data['center'] + offset) / depth, horizon + f * (h - y) / depth, depth

    order = sorted(data['triangles'], key=lambda t: not data['materials'][t[0]]['shadow'])
    for t in order:
        m = data['materials'][t[0]]
        tex = textures[t[0]]
        tw, th = tex.size
        P = [project(data['vertices'][i]) for i in t[1:4]]
        uv = [(t[4], t[5]), (t[6], t[7]), (t[8], t[9])]
        (x0, y0, d0), (x1, y1, d1), (x2, y2, d2) = P
        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if abs(area) < 1e-9:
            continue
        for sy in range(max(0, int(min(y0, y1, y2))), min(height, int(max(y0, y1, y2)) + 2)):
            for sx in range(max(0, int(min(x0, x1, x2))), min(width, int(max(x0, x1, x2)) + 2)):
                qx, qy = sx + 0.5, sy + 0.5
                w0 = ((x1 - qx) * (y2 - qy) - (x2 - qx) * (y1 - qy)) / area
                w1 = ((x2 - qx) * (y0 - qy) - (x0 - qx) * (y2 - qy)) / area
                w2 = 1 - w0 - w1
                if min(w0, w1, w2) < -1e-6:
                    continue
                inv = w0 / d0 + w1 / d1 + w2 / d2
                depth = 1 / inv
                u = (w0 * uv[0][0] / d0 + w1 * uv[1][0] / d1 + w2 * uv[2][0] / d2) * depth
                v = (w0 * uv[0][1] / d0 + w1 * uv[1][1] / d1 + w2 * uv[2][1] / d2) * depth
                c = tex.getpixel((min(tw - 1, max(0, int(u))), min(th - 1, max(0, int(v)))))
                if m['shadow']:
                    if background[3] == 0:
                        continue  # a cut-out sprite carries no ground shadow
                    a = m['alpha'] * c[3] / 255
                    base = px[sx, sy]
                    px[sx, sy] = tuple(int(base[k] * (1 - a) + c[k] * a) for k in range(3)) + (255,)
                    continue
                if c[3] < 128 or depth >= zbuf[sy][sx]:
                    continue
                zbuf[sy][sx] = depth
                px[sx, sy] = c[:3] + (255,)
    return img


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    model, out = Path(sys.argv[1]), Path(sys.argv[2])
    tiles: list[tuple[str, Image.Image]] = []
    if len(sys.argv) > 3:
        sprite = Image.open(sys.argv[3]).convert('RGBA')
        box = Image.new('RGBA', (140, 160), GROUND)
        box.alpha_composite(sprite, ((140 - sprite.width) // 2, int(170 * 0.72) - 10 - sprite.height))
        tiles.append(('sprite', box))
    for label, offset in (('left', -150), ('centre', 0), ('right', 150)):
        shot = render(model, offset)
        # Keep the building in frame: crop around where it lands (zoom 1: one world px per screen px).
        cx = int(shot.width / 2 + offset)
        tiles.append((label, shot.crop((cx - 70, 10, cx + 70, 170))))
    w = sum(t.width for _, t in tiles) + 8 * len(tiles)
    sheet = Image.new('RGBA', (w, 174), (17, 22, 38, 255))
    draw = ImageDraw.Draw(sheet)
    x = 0
    for label, t in tiles:
        sheet.paste(t, (x, 14))
        draw.text((x + 2, 1), label, fill=(255, 216, 74, 255))
        x += t.width + 8
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(out)
    print(out)


if __name__ == '__main__':
    main()
