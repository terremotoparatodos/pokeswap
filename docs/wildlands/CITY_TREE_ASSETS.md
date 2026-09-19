# City tree family — reusable assets (DEV contract)

Branches: `tool/city-tree-assets` (base `tool/city-mapping-lab @ 9c468b2`), polish in
`tool/city-tree-assets-polish` (base `tool/city-tree-assets @ cbb03bd`).
Code: `src/features/worldAssets/trees/` (no Vue, no editor; only imports `wildlands/engine`).
Consumed only by the City Mapping Lab (`/dev/city-lab`, DEV). **Production does not import it**:
not WildLands, not the generator, not TownDef.

## Audit: how the city forest is drawn today

- There are no tree props: `TownArea.ensureArt` walks the `t` terrain in **2×2 blocks aligned to
  even coordinates**. With ≥3 forest tiles in a block → one full tree; with 1–2 → bushes.
- Variant per block: `HEARTHOME.art.trees[|bx·7 + by·13| mod 3]` (3 hand-drawn PNGs).
- Feet: `x = (bx+1)·16 + jitter(−2..2)`, `y = (by+2)·16 − 2`. Loaded with `loadImageSprite(src)`
  → anchor `(w/2, h−1)`, no `flatTop`, projected shadow on.
- Collision: the whole `t` tile (all forest is solid).

| PNG | Size | Crown | Trunk/roots (sprite px) | Baked shadow | Palette |
|---|---|---|---|---|---|
| `tree-a` | 41×51 | pointed, leaf scales | x 10–30, y 40–46 | ellipse x 5–35, y 37–50 (`#0e8951`) | greens `#384830…#88e048`, trunk `#8b6d45/#9b7d4d` |
| `tree-b` | 41×51 | same as a + pale highlights (`#afd8bb`) | same | same | same + highlights |
| `tree-c` | 43×48 | round, olive | x 12–30, y 38–42 | ellipse x 7–35, y 36–47 (muted green) | olives `#39452c…#7bbe2e` |

The city PNGs don't include smaller, darker or conifer variants. In the second pass the
original tileset (`buildings.png`) turned out to hold two more trees of the same set, and the variety comes from there
plus bands of real pixels (see below). `PALM TREE — FUTURE ASSET` (the city has no palm).

## Taxonomy (`CityTreeId`) — 8 variants

| id | origin | size | trunk (px) | base on grass |
|---|---|---|---|---|
| `city-tree-pointed` | forest (`tree-a`) | 41×51 | 10–30 × 40–46 | tufts |
| `city-tree-pointed-lit` | forest (`tree-b`) | 41×51 | 10–30 × 40–46 | tufts |
| `city-tree-round` | forest (`tree-c`) | 43×48 | 12–30 × 38–42 | roots |
| `city-tree-golden` | same tileset, unused by the city (autumn) | 33×48 | 8–24 × 38–43 | roots |
| `city-tree-teal` | same tileset, unused (lobed crown) | 39×47 | 10–28 × 33–39 | roots |
| `city-tree-pointed-tall` | derived: +1 tier of scales (rows 10–16 repeated) | 41×57 | 10–30 × 46–52 | tufts |
| `city-tree-pointed-slim` | derived: central columns 18–23 removed | 36×51 | 10–25 × 40–46 | tufts |
| `city-tree-round-wide` | derived: central columns 18–24 repeated | 49×48 | 12–36 × 38–42 | roots |

- The first three are the forest's order: `forestVariantAt(bx, by)` says which one a generated block shows.
- Left out on purpose: the sheet has a *dark teal* tree with exactly the same silhouette as `teal`
  (a pure hue shift).
- The derived variants splice **bands of real pixels** at the point where the edges match best
  (fewest differing pixels), so the scale/leaf pattern continues. No scaling, hue shift or mirroring.
- `treeVariantForTile(tx, ty)` ("Árbol aleatorio") hashes the tile: same position → same variant. The placed
  tree stores the variant it got; re-importing never re-rolls it.

## Placeable PNGs and ground base (polish)

- `scripts/build_city_tree_assets.py` (pure Pillow, reproducible) writes
  `src/features/worldAssets/trees/art/*.png`:
  - It removes the baked shadow: the ring colours (`#0e8951`, `#53754c`, `#4b7144`, the teal's greens)
    and the core under the roots. Crown, trunk, roots and their outline stay.
  - It pads with transparent rows so each tree keeps its source's root height above the feet.
    The loader's default anchor `(w/2, h−1)` then stands it exactly like the forest.
- The PNGs are **imported** from the module, not served from `public/`. They only ship if production code
  imports the module (today only the DEV lab). `dist` has none of them.
- **The forest keeps `public/assets/town/tree-{a,b,c}.png` untouched** (FNV-pinned in tests).
- Ground base (`treeGroundBase.ts`): painted on the ground (under every sprite, projected with the
  terrain). It's a translucent near-black (`#141c10`, alpha 46/78/104) dithered at the edge, so it darkens
  whatever terrain is there without tinting it. 4 styles, chosen **automatically** from the terrain under
  the trunk and the tree:
  - `grass-tufts` (city grass / WildLands grass, pointed trees): shadow + two clumps of grass.
  - `grass-roots` (grass, round/golden/teal trees): shadow + root nubs in the trunk's own palette.
  - `paved` (plaza, street, sand): a slightly smaller, lighter shadow only.
  - `forest`: a denser shadow only.
- The base is **not** in the patch (it's derived); neither is pan, zoom or lens.

## Contract (`CityTreeAssetDefinition`)

- **Cell**: `(tx, ty)` = top-left tile of the 2×2 block (like a forest block).
- **Feet / anchor**: `treeFeet(tx, ty) = ((tx+1)·16, (ty+2)·16 − 2)`, the exact point where TownArea
  stands a forest tree (without jitter). Sprite anchor `(w/2, h−1)`. Z-sort by the feet's `y`
  (the renderer's own rule).
- **Visual footprint**: the 4 tiles of the cell.
- **Collision footprint**: the cell's **bottom row** (2×1). The roots sit 4–10 px above
  the feet, centred on the seam between the two columns. The top row (crown) can be walked:
  you pass *behind* the tree and the crown covers you.
- **Tap hitbox**: 32 px wide (the cell's two columns) × from the feet to the top of the crown
  (50 px pointed, 47 px round). It's narrower than the art (41–43 px), so the side leaves
  don't steal taps from the neighbouring tiles.
- **Sprite bounds**: `(−w/2, −(h−1)) → (w/2, 1)` around the feet.
- The sprite is loaded with the **same** call and options as the forest → it's the same `Sprite` object from cache.

## In the Mapping Lab

- Palette "Árboles" (thumbnail = real PNG, "2×2 · tronco 2×1" badge). The current WildLands trees
  still appear separately as "Árboles de WildLands (actuales)", for comparison only.
- Placing: the cursor puts the left half of the trunk; a green/red preview shows the cell and the trunk (white border).
- Rules: the trunk can't go on a building, fountain, another trunk/prop, portal, door, door exit, spawn or arrival.
  **Crowns may overlap** (with each other, with props and with buildings).
- Layers: "Sprite bounds / tap hitbox" (cyan / dashed magenta), "Footprints" (green cell, red trunk),
  "Árboles: F bosque / P placed".
- PLAY: collision on the trunk, z-sort by feet, click on the crown → walks to the tree (not to the tile behind).
- Validate Map: `TREE_TRUNK_CONFLICT`, `TREE_HIDDEN` (whole cell inside the forest), plus the existing
  connectivity checks. Multiplayer widths count **only the trunk**.
- Patch: `{ id, kind: <CityTreeId>, tx, ty, footprint: { w: 2, d: 2 } }`, never pixels.
  `requiresProductionSchemaSupport: true` while TownDef has no slot. Byte-identical round trip.
- "🌳 Comparar árboles": forest vs placed on grass / plaza / street edge / forest, and a
  WildLands DEV tab (Pradera Brisa, real procedural world) with the same assets drawn through the overlay.

## Toward official WildLands trees (for the main station)

1. Give the chunk decor (`chunks.ts` / `world.decorAt`) or a new `DecorKind` a way to represent a 2×2 tree
   (today every world prop is 1 tile, anchored at `tile·16 + (8, 13)`).
2. Shadow: **solved in the lab** with the shadow-free PNGs + a ground base per terrain. For WildLands, the
   chunk renderer would need to paint the base (today only the town/overlay can). `wildGround()` already
   maps GRASS/TALL → grass and the rest → plain shadow.
3. Collision in worlds: a 2×1 trunk vs today's 1 tile; check against water/beach/tall grass.
4. Density/seed: replacing `tree` in the generator changes every forest's layout. Needs a separate
   migration and visual review per biome.
5. TownDef: a `trees` (or equivalent) slot for placed city trees.
