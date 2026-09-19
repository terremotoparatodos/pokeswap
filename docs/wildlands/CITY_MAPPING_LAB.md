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

- `areas/hearthome.ts` → `TownDef`: data (terrain `s/g/p/t` 64×51, buildings
  with footprint/door/`open`/feature/PNG, fountains, props `lamp/sign/hedge/fenceH/fenceV`,
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

## Fences

- Fences autotile (`engine/townProps.ts → fencePiece`): a horizontal run and a vertical run
  that touch meet at a corner picket. Place plain `Valla ─` / `Valla │`; the corner is automatic.
- A vertical run is drawn as upright posts, one every 8 px on the ground (`fencePosts`), not
  one sprite per tile: the tilted player camera spaces them like the ground, the posts in
  front cover the ones behind, and they keep their height.
- Art: `scripts/build_town_street_art.py` (pieces cut from the city tileset).
- Benches (`bench`, `benchLeft`: backrest right / left) cover 1×2 tiles and are drawn from
  Platinum's own 3D models.

## 3D models (Platinum's own)

- `scripts/build_town_models.py <folder>` converts the exported OBJ/MTL/PNG models into
  `public/assets/town/models/<id>.json` + textures. Model units are world px (a 16-unit tile).
  The DS repeat/mirror of each texture is listed per material in the script and baked into
  expanded textures, so the game never wraps.
- `engine/townModel.ts` draws a model with the scene projector (same perspective as the
  ground). Like the DS it skips back faces and uses a depth buffer (sorting triangles fails on
  pieces set into each other), rasterizing at about screen resolution (`MODEL_DETAIL`), so
  edges are as fine as the rest of the frame. The image is reused while the camera moves less
  than `MODEL_REDRAW_STEP` world px relative to it. A building to one side of the screen shows
  its real side wall.
- Ciudad Corazón uses the `town` lens (`engine/projection.ts`): ground at 0.85 and 3D models at
  0.62 of their height (`rise`), the proportions of Platinum's own sprites; the steeper camera also
  hides less behind each building. Sprites are unaffected (they are drawn that way already).
- `scripts/preview_town_model.py <model.json> <out.png> [sprite.png]` renders a converted
  model left of, at and right of the screen centre, to check textures and walls before use.
- The Pokémon Center, the Poké Mart and the gym are HeartGold/SoulSilver's models (closer to Platinum
  than Diamond/Pearl's). The Mart's sign post stands past its footprint (`center` option).
- Each converted model also gets `<id>-sprite.png`, its front render: the palette thumbnail
  and loading fallback. Models no city building uses (the Celadon Condominiums)
  are placeable from the lab's palette → Edificios → Modelos 3D.
- Per-model options in the converter: `center` / `front` (where the body stands, ignoring a
  sign post or a painted shadow) and `skip` (materials not drawn, e.g. a lamp's glow: the game
  lights lamps itself, at the model's lamp head). A ground shadow is a translucent material
  lying on the ground; it may also darken a roof (drawn after the solids, over what it is not
  behind). `scale` converts a model exported in other units (the fountain came at
  1/8: 8 px per unit).
- A building opts in with `image.model` (the PNG stays as loading fallback and for the ground
  dressing); fountains with `art.fountains[i].model`; props with `art.models[kind]`. Today: the Pokémon Center, the Poké Mart, the gym, Silph Co. (where the Contest Hall was), the
  three route gates (door on their portal), the houses and apartments (Celadon's buildings), the
  street lamps, the fountains, both benches, Mr. Pokémon's House (where the Fan Club was, Pokédex)
  and the Casino (where the Poffin House was, Perfil); the north exits (Tundra, Costa) are route
  gates too. The whole city is 3D.

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
  Keys `+`, `-`, `0`. Range 20 %–250 %. "Encuadrar ciudad" fits the whole map (its four corners,
  in perspective) and centres it vertically.
- Lenses: "Planta" (near top-down, the game's distance, so a framed city is drawn whole) and
  "Vista jugador" (the town camera the player has). Both show 3D models at the game's height.
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
