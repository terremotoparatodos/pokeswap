# WildLands City Mapping Lab (DEV)

`/dev/city-lab`. Development only: registered behind `import.meta.env.DEV`
in `src/app/router/routes.ts`, like `/dev/dungeon`. It doesn't exist in `dist`.

Base: `integration/r31 @ 7c3af212d0cfb604b0741c89a7e54028c26fb2f0`.
Station: secondary. Doesn't touch R32, battle, the Pokémon model, authority, networking, Supabase or persistence.

## What it is

A mini editor for Ciudad Corazón: **EDIT → PLAY → EDIT → EXPORT PATCH**.
It edits a *working copy*. The production town (`areas/hearthome.ts`,
`areas/hearthomeTerrain.ts`) is never written. The output is a JSON patch for
human review.

## How the city is built today (audit)

- `areas/hearthome.ts` → `TownDef`: data (terrain `s/g/p/t` 64×49, buildings
  with footprint/door/`open`/feature/PNG, fountains, props `lamp/sign/bench/hedge/fenceH/fenceV`,
  gates (portal tiles + arrival), spawn, residents, wanderers, plots, plazaZones).
- `areas/townArea.ts` → `TownArea(def)`: collision (forest `t`, footprints minus
  door/`open`, fountains, solid props, portals forced walkable), ground baking
  (`engine/townGround.ts`) and sprites (hand-drawn PNGs with a code-painted fallback).
- The forest trees are not props: they come from `t` terrain in 2×2 blocks.
- `engine/placedObjects.ts` (F-1) is not used in the town. It's the professions' layer
  in the worlds, so the lab doesn't use it either.

## Architecture

| Layer | Files |
|---|---|
| Pure domain | `domain/labCity.ts` (model + stable ids), `editOps.ts`, `placement.ts`, `cityGrid.ts`, `validateMap.ts`, `clearance.ts`, `cityPatch.ts`, `labHistory.ts`, `labDraft.ts`, `labCatalog.ts` |
| Real world | `world/labTownArea.ts` (**subclass of the real `TownArea`**), `labPlay.ts` (PLAY driver), `labOverlay.ts`, `labProjection.ts`, `labThings.ts`, `labPicking.ts` |
| State | `state/useCityLab.ts` |
| UI | `components/CityLabView.vue`, `LabStage.vue` (the real `Renderer`), toolbar, palette, inspector, findings, patch dialog |

- **Renderer**: the WildLands `Renderer`, with no copy. The debug layers go in through
  the official `SceneOverlay` port (painted onto the ground before projection).
- **Collision**: always the real `TownArea.isSolid` built from the working copy.
  Prop solidity is also asked of the engine (a probe for street props,
  `isSolidDecor` for world props).
- **PLAY**: `game.ts` can't take a working copy (its `Atlas` is private and
  builds production). `labPlay.ts` runs the same parts in the same order, the
  way the dungeon lab does: `createActor` + `PlayerAppearance` (same sheet), `driveWalker`
  (speed per tile, Shift to run), `TapNavigator` + `Entrances.retarget` (click-to-move
  to doors), `TownPopulace` (residents/wanderers), locked camera, `KeyboardInput`.
  It doesn't travel through gates or open panels. It shows what would happen.

## Ids (for the patch)

- props: `kind@tx,ty` from the baseline (`#2` suffix if duplicated); new ones: `new-N`.
- buildings: their `id`; fountains `fountain-i`; gates `gate-<to>`;
  residents `resident-i`, wanderers `wanderer-i`; new ones `…-new-N`.

## Patch (`wildlands-city-patch` v3, imports v1 and v2)

Deterministic JSON (lists sorted, fixed key order). It includes
`baseline` (FNV-1a fingerprint of the baseline) and only the differences:
`props.added/removed/moved/modified`, `terrain[] {tx,ty,from,to}`, `spawn`,
`buildings|fountains|gates.added/removed/moved`, `buildings.modified`
(name, text, function, look or size of a baseline building, v3), `residents.*`,
`wanderers.*`, `notes`. Moves carry `from`: if the baseline changed,
import reports conflicts instead of overwriting silently.
**It never applies itself to production.**

World props (trees, rocks, crystals…) have no slot in `TownDef`: the lab draws
them through `LabTownArea` and the patch marks them in `notes`. Applying them
requires engine support (main station's decision).

## Fences and benches

- Fences autotile (`engine/townProps.ts → fencePiece`): a horizontal run and a vertical run
  that touch get a real corner post (┌ ┐ └ ┘), and a vertical run sits under the picket of
  the corner it hangs from. Place plain `Valla ─` / `Valla │`; the corner is automatic.
- Benches are Platinum-style plaza benches and cover several tiles from their `(tx, ty)`:
  `bench` (long 1×3, backrest right), `benchLeft` (long 1×3, backrest left),
  `benchShort` (1×2) and `benchAcross` (2×1, facing down). All their tiles are solid.
- Art: `scripts/build_town_street_art.py` (fence pieces cut from the city tileset; benches
  drawn, since the sheet has none; the old "bench" PNGs were dirt ramps).

## Buildings from scratch

`domain/buildingCatalog.ts`, `editOps.addBuilding / editBuilding`. Palette → **Edificios**:
- **Con dibujo de la ciudad**: one template per hand-drawn building PNG of Ciudad Corazón
  (12), with that building's style, footprint, roof line (`flatTop`) and stairs (`open`).
- **Bloque pintado**: the engine's code-painted block for each style, 4×4 to start.
- Click: the cursor marks the **middle of the bottom row**. Same placement rules as moving
  a building (overlaps, props, spawn, arrivals, blocked door exit; forest only warns).
- New buildings get `building-new-N`, the name "Edificio nuevo" and **no function**.

Properties panel (for any building, new or from the city):
- **Nombre**, **Texto al mirarlo** (blurb).
- **Función (ENTRADA)**: none or a PokeSwap panel. The list says which building already
  has each one; picking a used one warns about the duplicate entrance. A function without
  a door gets one in the middle of the bottom row (with a warning).
- **Puerta**: column of the bottom row, or none (warns if the function is left without one).
- **Dibujo**: another template. A drawing brings its own footprint; a block keeps the
  current size. The building keeps its bottom row and centre.
- **Tamaño** 1–12 × 1–12 tiles: keeps the left side and the front row. With a drawing,
  the PNG doesn't stretch (only collision and footprint change; it warns).
- In the patch: new buildings are full records in `buildings.added`; edits to the city's
  own buildings go to `buildings.modified`. Validate Map keeps reporting
  `ENTRANCE_DUPLICATED`, `ENTRANCE_WITHOUT_DOOR` and `BUILDING_ISOLATED`.

## LOCAL DRAFT vs EXPORT

- LOCAL DRAFT: autosave of the patch in this browser's `localStorage`
  (`pokeswap.dev.cityLab.draft.v1`), offered on the next load
  (Recuperar/Descartar). It's not persistence and nobody else reads it.
- EXPORT PATCH: copy or download `.json`. It's the only output.

## Entradas y salidas

The "Entradas y salidas" layer (on by default, in EDIT and PLAY) marks on the map:
- **ENTRADA · <function>** (orange): the door tile of each building that opens a
  PokeSwap panel, plus the tile where the player comes out.
- **SALIDA → <world>** (blue): the portal tiles, a dashed line and the
  **llegada ← <world>** point where you appear when coming back.

## Shortcuts (EDIT)

**Camera (EDIT)** — `world/editorCamera.ts`, `world/editorGestures.ts`:
- Drag on empty ground → **pan** (the map follows the cursor 1:1; cursor `grab/grabbing`).
- Drag that starts on an object → **move** that object (as before).
- **Space + drag**, middle or right button → pan from anywhere, even over objects.
- With **Agregar**: a click places, a drag only pans (it never places by accident).
- 5 px threshold before a press counts as a drag.
- **Wheel** → zoom centred on the cursor. `− 100% +`, Reset and "Encuadrar ciudad" buttons.
  Keys `+`, `-`, `0`. Range 35 %–250 %.
- The hovered tile and the placement preview are recomputed every frame from the last cursor position,
  so zooming with the buttons or panning with WASD never leaves them stale.
- EDIT → PLAY → EDIT restores the editor's pan and zoom. PLAY uses the game's camera.
- Pan, zoom, lens and the last palette choice are DEV preferences (`pokeswap.dev.cityLab.prefs.v1`),
  separate from the LOCAL DRAFT and never in the patch.

Click: select · drag: move with snap and live validation (green/red ghost) ·
arrows: move the selection 1 tile · WASD: camera · Supr: delete · Ctrl+D: duplicate ·
Ctrl+Z / Ctrl+Y: undo/redo · G: grid · P: PLAY · Esc: deselect / back to Seleccionar.
PLAY: arrows/WASD, Shift runs, E talks, click walks, V lens, N time, Esc returns.

## Known limits

- Everything can be deleted and duplicated (buildings, exits, fountains, props, NPCs),
  except the PLAYER SPAWN, which is only moved. What breaks gets a warning when you do it,
  and Validate Map reports it: a function without an ENTRADA, a world without a SALIDA, duplicated entrances or exits,
  a portal with no building.
- The engine's `cenital` lens (distance 4200) draws no ground: it sits past
  the renderer's `MAX_DEPTH` (1500). The lab uses its own "Planta" lens (distance 1300).
  The production bug is recorded. It isn't fixed here.
- Plots and plazaZones are shown (layer "Plazas / manzanas") but not edited:
  moving a building doesn't move its sidewalk block.
- The multiplayer heuristic is visual: a tile's width = side of the largest walkable
  square that contains it (cap 4).
