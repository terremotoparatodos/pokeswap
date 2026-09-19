"""Converts Platinum town models (OBJ + MTL + PNG) into WildLands town models.

The models were exported from the DS games (MKDS Course Modifier); the folder
layout below is the one they were handed over in. Their units
are world pixels already: a 16-unit tile is a 16 px tile. The DS repeats or
mirrors each texture per axis, and the OBJ loses those flags, so each material
lists its wrap here (found by rendering against the town's own sprites). The
wrap is baked into an expanded texture, so the game maps every triangle inside
one image without wrapping:

    public/assets/town/models/<id>.json          vertices, triangles, materials
    public/assets/town/models/<id>-<mat>.png      expanded textures

Model space: x to the right, y up, z toward the viewer (the front). The game
stands the model on its footprint (engine/townModel.ts).

    python scripts/build_town_models.py <folder with the exported models>
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/town/models'

# id: (source OBJ relative to the input folder, {material: (wrap u, wrap v)}[, options])
# options: 'center' — the x that stands on the footprint's centre, when the model reaches
# past its building on one side (the Poké Mart's sign post).
MODELS = {
    # HeartGold/SoulSilver's Pokémon Center (closer to Platinum than Diamond/Pearl's).
    'pokecenter': ('Pokemon Center HG/Pokémon Center.obj', {'gs_pc_a': ('repeat', 'repeat'), 'gs_pc_b': ('repeat', 'repeat')}),
    # HeartGold/SoulSilver's Poké Mart: the building is x −32…32; its sign post stands to the right.
    'mart': ('Poké Mart/Poké Mart.obj', {'fs_a': ('repeat', 'mirror')}, {'center': 0}),
    'bench-1': ('Bench 1/Bench 1.obj', {'lambert2': ('repeat', 'repeat')}),
    'bench-2': ('Bench 2/Bench 2.obj', {'lambert2': ('repeat', 'repeat')}),
}
# The ground shadow under every model: the translucent material (h_kage / kage in the MTL).
def is_shadow(material: dict) -> bool:
    return material['alpha'] < 1


def parse_mtl(path: Path) -> dict:
    materials, cur = {}, None
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == 'newmtl':
            cur = materials.setdefault(p[1], {'alpha': 1.0, 'texture': None})
        elif p[0] == 'd' and cur is not None:
            cur['alpha'] = float(p[1])
        elif p[0] == 'map_Kd' and cur is not None:
            cur['texture'] = p[1]
    return materials


def fold(t: float, mode: str) -> float:
    if mode == 'mirror':
        t %= 2.0
        return 2.0 - t if t > 1.0 else t
    return t % 1.0


def expand(tex: Image.Image, u_range, t_range, wrap) -> tuple[Image.Image, int, int]:
    """The texture tiled over the UV range the model uses, with the DS wrap baked in."""
    w, h = tex.size
    u0, t0 = math.floor(u_range[0]), math.floor(t_range[0])
    nu = max(1, math.ceil(u_range[1]) - u0)
    nt = max(1, math.ceil(t_range[1]) - t0)
    out = Image.new('RGBA', (nu * w, nt * h))
    src = tex.load()
    dst = out.load()
    for py in range(nt * h):
        sy = min(h - 1, int(fold(t0 + (py + 0.5) / h, wrap[1]) * h))
        for px in range(nu * w):
            sx = min(w - 1, int(fold(u0 + (px + 0.5) / w, wrap[0]) * w))
            dst[px, py] = src[sx, sy]
    return out, u0, t0


def convert(folder: Path, model_id: str, obj: str, wraps: dict, options: dict | None = None) -> None:
    options = options or {}
    obj_path = folder / obj
    mtl = parse_mtl(obj_path.with_suffix('.mtl'))
    V, T, faces, cur = [], [], [], None
    for line in obj_path.read_text(encoding='utf-8', errors='replace').splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == 'v':
            V.append([float(x) for x in p[1:4]])
        elif p[0] == 'vt':
            T.append([float(x) for x in p[1:3]])
        elif p[0] == 'usemtl':
            cur = p[1]
        elif p[0] == 'f':
            idx = [[int(x) - 1 for x in q.split('/')[:2]] for q in p[1:]]
            for i in range(1, len(idx) - 1):  # fan into triangles
                faces.append((cur, idx[0], idx[i], idx[i + 1]))

    names = sorted({f[0] for f in faces}, key=lambda m: (not is_shadow(mtl[m]), m))
    materials, tri = [], []
    for m in names:
        used = [f for f in faces if f[0] == m]
        us = [T[c[1]][0] for f in used for c in f[1:]]
        ts = [1 - T[c[1]][1] for f in used for c in f[1:]]  # image rows run down
        tex = Image.open((obj_path.parent / mtl[m]['texture'])).convert('RGBA')
        wrap = wraps.get(m, ('repeat', 'repeat'))
        big, u0, t0 = expand(tex, (min(us), max(us)), (min(ts), max(ts)), wrap)
        file = f'{model_id}-{m}.png'
        big.save(OUT / file)
        w, h = tex.size
        materials.append({'name': m, 'texture': file, 'alpha': round(mtl[m]['alpha'], 4), 'shadow': is_shadow(mtl[m])})
        k = len(materials) - 1
        for _, a, b, c in used:
            uv = []
            for corner in (a, b, c):
                u, v = T[corner[1]]
                uv += [round((u - u0) * w, 3), round((1 - v - t0) * h, 3)]
            tri.append([k, a[0], b[0], c[0], *uv])

    xs, ys, zs = zip(*V)
    # The solid part (not the ground shadow) decides where the model stands.
    solid = sorted({i for t in tri if not materials[t[0]]['shadow'] for i in t[1:4]})
    sx = [V[i][0] for i in solid]
    sz = [V[i][2] for i in solid]
    model = {
        'id': model_id,
        'source': obj,
        'bounds': {'x': [min(xs), max(xs)], 'y': [min(ys), max(ys)], 'z': [min(zs), max(zs)]},
        # Middle of the solid part across, and its front: the model stands with them on its footprint.
        'center': round(options.get('center', (min(sx) + max(sx)) / 2), 4),
        'front': round(max(sz), 4),
        'vertices': [[round(c, 4) for c in v] for v in V],
        'materials': materials,
        'triangles': tri,
    }
    (OUT / f'{model_id}.json').write_text(json.dumps(model, separators=(',', ':')), encoding='utf-8')
    print(f'{model_id:12} {len(V):4} verts {len(tri):4} tris  {[m["name"] for m in materials]}')


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for model_id, (obj, wraps, *options) in MODELS.items():
        convert(folder, model_id, obj, wraps, *options)


if __name__ == '__main__':
    main()
