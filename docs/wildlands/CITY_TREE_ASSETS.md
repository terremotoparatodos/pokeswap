# City tree family — reusable assets (DEV contract)

Branch `tool/city-tree-assets` (base `tool/city-mapping-lab @ 9c468b2`).
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

There are no smaller, darker or conifer variants in the art. **None were invented.**
`PALM TREE — FUTURE ASSET` (the city has no palm).

## Taxonomy (`CityTreeId`)

| id | PNG | label |
|---|---|---|
| `city-tree-pointed` | tree-a | Pointed crown |
| `city-tree-pointed-lit` | tree-b | Pointed crown · highlights |
| `city-tree-round` | tree-c | Round crown |

The order is the forest's order: `forestVariantAt(bx, by)` says which asset a generated block shows.

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
2. Decide the baked shadow: the PNG's ellipse (`#0e8951`) is tuned for the city grass. On
   WildLands grass it reads as a greenish ring (visible in the DEV preview). Options: a variant without a baked shadow,
   or recolouring per biome.
3. Collision in worlds: a 2×1 trunk vs today's 1 tile; check against water/beach/tall grass.
4. Density/seed: replacing `tree` in the generator changes every forest's layout. Needs a separate
   migration and visual review per biome.
5. TownDef: a `trees` (or equivalent) slot for placed city trees.
