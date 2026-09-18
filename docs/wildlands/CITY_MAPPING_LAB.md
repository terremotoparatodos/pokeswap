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

## Patch (`wildlands-city-patch` v2, imports v1)

Deterministic JSON (lists sorted, fixed key order). It includes
`baseline` (FNV-1a fingerprint of the baseline) and only the differences:
`props.added/removed/moved/modified`, `terrain[] {tx,ty,from,to}`, `spawn`,
`buildings|fountains|gates.added/removed/moved`, `residents.*`,
`wanderers.*`, `notes`. Moves carry `from`: if the baseline changed,
import reports conflicts instead of overwriting silently.
**It never applies itself to production.**

World props (trees, rocks, crystals…) have no slot in `TownDef`: the lab draws
them through `LabTownArea` and the patch marks them in `notes`. Applying them
requires engine support (main station's decision).

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

Click: select · drag: move with snap and live validation (green/red ghost) ·
arrows: move the selection 1 tile · WASD / right-click drag / Alt+drag: camera ·
wheel: zoom · Supr: delete · Ctrl+D: duplicate · Ctrl+Z / Ctrl+Y: undo/redo ·
G: grid · P: PLAY · Esc: deselect / back to Seleccionar.
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
