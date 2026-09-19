# Town 3D + City Mapping Lab — integration handoff

For the main station. Everything here can be integrated without knowing the
conversation that produced it.

## 1. Frozen reference

| | |
|---|---|
| Frozen branch | `feat/town-3d-models` |
| HEAD | `87504b792c48e240d866e43a65619be08e4e8927` |
| Local vs remote | identical (0 ahead / 0 behind), working tree clean |
| Status | human-reviewed, **integration candidate**, no PR, not merged anywhere |
| This document | on `docs/town-3d-handoff` (one doc commit on top of `87504b7`); the frozen ref is untouched |

## 2. Ancestry

Linear history, no merge commits: 27 commits on top of `origin/integration/r31 @ 7c3af21`.

| Branch | Tip | Merge-base with 87504b7 | In `feat/town-3d-models`? |
|---|---|---|---|
| `origin/integration/r31` | `7c3af21` | `7c3af21` | contained (it is the base) |
| `origin/main` | `480b352` | `480b352` | contained (ancestor of r31) |
| `tool/city-mapping-lab` | `9c468b2` | `9c468b2` | **contained** |
| `tool/city-tree-assets` | `cbb03bd` | `cbb03bd` | **contained** |
| `tool/city-tree-assets-polish` | `caa89ce` | `caa89ce` | **contained** |
| `tool/city-lab-buildings` | `b805416` | `b805416` | **contained** |
| `feat/town-fences-benches` | `a406e11` | `a406e11` | **contained** |
| `feat/town-building-depth` | `e8f6e10` | `a406e11` | **not contained** (abandoned: generic box walls, replaced by real 3D models) |
| `feat/r32-4-authority-foundations` | `3736a8e` | `7c3af21` | not contained (main station line) |
| `feat/r33-stations-product` | `13de6b0` | `7c3af21` | not contained (main station line) |

The branch is **cumulative**: every useful secondary branch of this line is an
ancestor. Nothing else has to be integrated with it; `feat/town-building-depth`
must be **discarded** (its single commit is superseded).

## 3. Commit graph (`7c3af21..87504b7`)

| # | Commit | Title | Purpose |
|---|---|---|---|
| 1 | `cebafb5` | working-copy model, edit ops, validation and patch format | Lab domain (DEV) |
| 2 | `93546cb` | DEV-only City Mapping Lab at /dev/city-lab | Lab UI + DEV route |
| 3 | `9c468b2` | edit everything, show entrances and exits | Lab (DEV) |
| 4 | `cbb03bd` | city tree family as reusable assets | Tree assets, lab-only (DEV) |
| 5 | `caa89ce` | tree polish — ground bases, 8 variants, editor pan/zoom | Trees + editor camera (DEV) |
| 6 | `b805416` | add buildings from scratch and edit any building | Lab (DEV) |
| 7 | `33f2293` | autotiled fences with real corners, plaza benches | **Product**: fences/benches |
| 8 | `91d9b7d` | vertical fences / benches in the player camera | **Product** (intermediate) |
| 9 | `1f0cfef` | paint benches and vertical fences into the ground | **Product** (intermediate, later reverted in #10) |
| 10 | `a406e11` | upright fence posts; drop the benches | **Product**: final fence system |
| 11 | `a6ccc73` | Pokémon Center and benches from 3D models | **Product**: 3D model pipeline + renderer |
| 12 | `42afb79` | HeartGold Pokémon Center, depth buffer | **Product**: rasterizer |
| 13 | `0df6af1` | screen-resolution rasterizing + redraw cache | **Product**: renderer quality/perf |
| 14 | `a4eadb5` | Poké Mart model | **Product** |
| 15 | `eb1c5f6` | Poké Mart texture wrap fix | **Product** (asset) |
| 16 | `1e903fc` | gym model | **Product** |
| 17 | `797d158` | Game Corner as placeable 3D building | Lab palette + model-only buildings |
| 18 | `5af739b` | Celadon Condominiums placeable | Lab palette (asset shipped, unused by the city) |
| 19 | `fdd98b7` | street lamps model | **Product** |
| 20 | `50aab38` | Silph Co. replaces the Contest Hall | **Product** |
| 21 | `6b4eb81` | fountains model | **Product** |
| 22 | `5f810e6` | route gates models; shadow decals | **Product** |
| 23 | `c19ce58` | steeper town camera (`town` lens); south gate clears its portal | **Product** |
| 24 | `2bfaea7` | houses and apartments from Celadon buildings | **Product** |
| 25 | `cf0b6aa` | Mr. Pokémon's House and the Casino | **Product** |
| 26 | `564cf0b` | north exits are route gates too | **Product** |
| 27 | `87504b7` | final alignment pass; editor frames the whole city | **Product** + editor |

Commits 8–9 are intermediate states (their net effect is superseded by #10); a
squash of the product commits is safe.

## 4. Changed files (179 files, +8554 / −65 vs `integration/r31`)

### PRODUCT (changes the real game)

Engine / city code (`src/features/wildlands`):

- `areas/hearthome.ts` — city data (buildings, models, props, signs, lens, NPC lines)
- `areas/hearthomeTerrain.ts` — terrain 64×49 → 64×51
- `areas/townArea.ts` — fence autotiling, multi-tile props, 3D model loading, `ArtImage.model`, `TownArtSet.fences/models`
- `engine/townModel.ts` (new) — 3D model loader + rasterizer
- `engine/townProps.ts` — `bench`/`benchLeft` (1×2), fence autotile (`fencePiece`, `fencePosts`, `fenceTileArt`), prop footprints/feet
- `engine/renderer.ts` — draws a decor's 3D model instead of its sprite; lamp glow height
- `engine/projection.ts` — `CameraLens.rise`, new `LENSES.town`
- `engine/chunks.ts` — `DecorInstance.model`
- `engine/dialogue.ts` — one ambient line (Silph Co.)
- tests: `areas/atlas.test.ts` (51 rows), `engine/townModel.test.ts` (new), `engine/townProps.test.ts` (new)

Assets (`public/assets/town`):

- fences: `fence-h.png` (M), `fence-corner-left.png`, `fence-corner-right.png`, `fence-post.png` (A); `fence-v.png` (D)
- removed: `bench-a.png`, `bench-b.png` (they were dirt ramps, not benches)
- `models/` (A, ~595 KB in `dist`): per model `<id>.json`, `<id>-<material>.png` textures, `<id>-sprite.png` (front render: loading fallback / palette thumbnail). Models: `pokecenter`, `mart`, `gym`, `silph`, `mrpokemon`, `casino`, `celadon-green`, `celadon-tall`, `gate-west`, `gate-east`, `gate-south`, `gate-north`, `lamp`, `fountain`, `bench-1`, `bench-2`, and `condo` (lab palette only; shipped but unused by the city).
- The old building PNGs (`contest.png`, `fanclub.png`, `poffin.png`, …) stay; several are still the loading fallback of their building.

Tooling that produced product assets (not bundled): `scripts/build_town_models.py`, `scripts/preview_town_model.py`, `scripts/build_town_street_art.py`, `scripts/extract_town_sprites.py` (M: no longer writes fences/benches).

Docs: `docs/wildlands/HANDOFF.md` (M: door list), `docs/wildlands/LOBBY_INTEGRATION_PLAN.md` (M: Silph Co.).

### DEV-ONLY (Mapping Lab and tools; not in the production bundle)

- `src/app/router/routes.ts` — only change: DEV-guarded lazy route `/dev/city-lab` (`dev-city-lab`). Verified absent from `dist`.
- `src/features/cityLab/**` (37 files, all new): `components/{CityLabView,LabFindings,LabInspector,LabPalette,LabPatchDialog,LabStage,LabToolbar,TreeCompare}.vue`, `domain/{buildingCatalog,cityGrid,cityPatch,clearance,editOps,labCatalog,labCity,labDraft,labHistory,labPrefs,placement,validateMap}.ts`, `state/useCityLab.ts`, `world/{editorCamera,editorGestures,labOverlay,labPicking,labPlay,labProjection,labThings,labTownArea,treeShowcase}.ts`, tests (`cityLabIsolation`, `buildings.lab`, `cityPatch`, `cityTrees.lab`, `editOps`, `validateMap`, `editorCamera`).
- `src/features/worldAssets/trees/**` (new): `cityTrees.ts`, `cityTreeSprites.ts`, `treeGroundBase.ts`, `cityTrees.test.ts`, `art/*.png` (8). Imported **only** by the lab (enforced by `cityLabIsolation.test.ts`).
- `scripts/build_city_tree_assets.py`
- Docs: `docs/wildlands/CITY_MAPPING_LAB.md`, `docs/wildlands/CITY_TREE_ASSETS.md`

## 5. Player-visible changes

City layout and entrances (Ciudad Corazón):

| Change | Before | After |
|---|---|---|
| Map size | 64×49 | **64×51** (2 forest rows added at the **south**; no coordinate shifts) |
| Camera | `handheld` lens | **`town` lens** (ground squash 0.85, 3D model height ×0.62) |
| Contest Hall → **Silph Co.** (`contest`) | 7×8 at (28,7), sprite | **10×8 at (26,7)**, 3D; door (31,14) and Swap unchanged |
| Fan Club → **Casa de Mr. Pokémon** (`fanclub`) | 5×6 at (10,24) | **4×4 at (10,26)**, 3D; door (11,29), Pokédex unchanged |
| Poffin House → **Casino** (`poffin`) | 5×6 at (39,24), door (41,29) | **7×4 at (37,26), door (40,29)**, 3D; Perfil |
| Tienda (`mart`) entrance | door (30,29) | **door (29,29)** (onto the model's door) |
| South gate (`gateS`) | 5×6 at (9,43) | **5×7 at (9,44)** (covers the 2 new rows); portal/arrival unchanged |
| West/east gates | sprites | 3D; **footprints unchanged** (0..5 / 58..63, rows 38..43); only the model is drawn 2 tiles inward |
| North exits (`amityL/R`) | sprites | 3D (Gate 3); footprints, stairs `open` tiles and portals unchanged |
| Pokémon Center, gym, houses, apartments | sprites | 3D models; footprints and doors unchanged |
| Benches | 4 one-tile "benches" (dirt ramp art) at (33,35),(33,37),(45,35),(45,37) | 4 **1×2** benches (3D) at the same anchors → tiles (33,35–38) and (45,35–38) solid |
| Hedges | column x=38 rows 26–29; row y=29 x 33–37 | column removed; row y=29 x **33–36** |
| Signs | Poffins sign (37,28); route sign (13,39) | **"Casino · Perfil…" (36,28)**; route sign **(14,40)** |
| Fences | 1 sprite per tile, pairs look, no corners | autotiled: continuous rails, corner pickets, vertical runs as upright posts every 8 px; **collision unchanged** |
| Lamps, fountains | sprites | 3D; positions/collision unchanged; night glow at the model's lamp head |
| NPC dialogue | "Club de Fans", "Salón de Concursos" | "Mr. Pokémon", "Silph Co." (text only, positions unchanged) |

Nothing else moves: spawn (31,20), all portals and arrivals, residents,
wanderers, plaza zones, plots, fountain rects are unchanged.

Newly **solid** tiles: Silph Co. x 26–27 and x 35 (rows 7–14); Casino block
x 37–43 rows 26–29 (was hedges, the Poffins sign and plaza; the removed hedge
column x 38 and hedge (37,29) fall inside it); the Mart's old door (30,29); bench
tiles (33,36),(33,38),(45,36),(45,38); south gate rows 49–50 (new rows).
Newly **walkable**: the old Fan Club tiles outside its new footprint (rows 24–25
x 10–14, and x 14 rows 26–29), the old Poffin House rows 24–25 (x 39–43),
south-gate row 43 (plaza), the Mart's new door tile (29,29).

## 6. 3D model architecture (contract)

**What a "3D model" is.** The HeartGold/SoulSilver building models (OBJ + MTL +
PNG, exported with MKDS Course Modifier) converted by `scripts/build_town_models.py`
into `public/assets/town/models/<id>.json` + textures. No procedural geometry,
no layers of sprites: real triangles with UVs.

- Units: 1 model unit = 1 world px (16 per tile); `scale` option for other exports (fountain ×8).
- DS texture repeat/mirror per material is baked into expanded textures (no runtime wrapping).
- `center` / `front`: the model x that sits on the footprint's centre and the z on its front edge (per-model overrides in the script).
- `skip`: materials not drawn (a lamp's glow quad). Shadow = translucent `*kage*` material or one lying on the ground.

**Drawing** (`engine/townModel.ts`, called from `renderer.drawSprites`):

- Each town decor entry (`DecorInstance`) may carry `model: { model, at }`.
  While the model loads, the entry's PNG sprite is drawn (fallback).
- Vertices are projected with the **scene projector** (same pinhole as the ground):
  x from the ground point, y = ground y − height × `lens.rise` × scale.
- Back faces are culled (models are single-sided, CCW).
- Rasterized in software with a **depth buffer** and perspective-correct UVs into
  a small offscreen canvas at ~screen resolution (`MODEL_DETAIL = 3` buffer px per
  world px), then blitted. Shadows are blended last (ground and roof shadows).
- Cache: the image is reused while the camera moves < `MODEL_REDRAW_STEP` (2 world
  px) relative to the model or the zoom/rise changes. Measured ~3 ms per large
  building per re-rasterization in Node.

**Depth / z-order.** A model is one drawable sorted like any sprite, by its feet
row (the front edge of the footprint). Inside the model the depth buffer decides.
Actors north of a building are drawn first and are hidden by it (same as before).

**Footprint / collision / doors / taps.** Unchanged system: `TownBuilding`
`x, y, w, d` (solid), `open` tiles, `door` (bottom-row threshold) and `feature`.
The model is purely visual and is placed from the footprint (`placeOnFootprint`).
Taps on buildings still resolve through the footprint (`doorForTap`); models add no
hit area. Ground aprons/plots are still measured from the fallback PNG sprite.

**Who uses it.** Every building of Ciudad Corazón (Pokémon Center, Tienda, Gimnasio,
Silph Co., Casa de Mr. Pokémon, Casino, 2 houses, 2 apartments, 5 route gates), the
14 lamps, the 3 fountains and the 4 benches. Legacy sprite-only: none in the city
(hedges, signs, fences and forest trees are still sprites/art, by design). WildLands
worlds are untouched (the `town` lens and models only apply to towns that opt in).

## 7. Fences, benches, other props

`feat/town-fences-benches` is **contained**. Final state (after `a406e11` and #11):

- Fences: `fenceH` / `fenceV` props autotile (`fencePiece`): straight runs with
  continuous rails, `cornerLeft/Right` pickets where a row meets a column, vertical
  runs drawn as upright posts every 8 px. Art from the city tileset
  (`scripts/build_town_street_art.py`). One tile of collision per fence prop, as before.
- Benches: new `TownPropKind`s `bench` (backrest right) and `benchLeft` (backrest
  left), 1×2 footprint (`townPropSize/Tiles/Feet`), drawn from the HeartGold bench
  models; the painted-ground bench approach of commits 8–9 was dropped.
- No other new prop families in production. (The lab can place world decor and city
  trees, but those are DEV-only and flagged in its patches.)

## 8. Trees

`tool/city-tree-assets-polish @ caa89cec6a77c92aa57d6a2b711a4102885ef1f3` **is contained**
(and `tool/city-tree-assets`). What it brings: `src/features/worldAssets/trees/**`
(8-variant city tree family, ground bases, sprites), the lab's tree palette/placement,
TreeCompare, and editor pan/zoom. **None of it is used by production**: forest trees in
towns are still the original `tree-a/b/c` PNGs generated from `t` terrain; WildLands
generation is untouched. Integrating placed trees into `TownDef`/WildLands remains a
separate line (see `docs/wildlands/CITY_TREE_ASSETS.md`).

## 9. City Mapping Lab (DEV) — editor capability

Route `/dev/city-lab` (DEV only). Not production changes.

- Edit / Play on a working copy of the real town (Play uses the game's town camera, walking, doors, portals, NPCs).
- Camera: drag-pan, Space/middle/right-drag pan, wheel zoom at the cursor, `− % +`, Reset, **Encuadrar ciudad** (fits all four corners in perspective, centred), keys `+ - 0`, zoom 20–250 %, lenses "Planta" and "Vista jugador" (town camera), both with 3D models at game height. Edit→Play→Edit restores the camera. Prefs in `pokeswap.dev.cityLab.prefs.v1`.
- Select / move / add / delete / duplicate; undo/redo; LOCAL DRAFT autosave.
- Buildings: templates from the city's art, 3D models (Condominios), painted blocks; inspector edits name, text, function, door, look, size.
- Props: street furniture (incl. benches, fences with autotile), world decor, city trees (8 variants, random-by-tile).
- Terrain brush (1×1 / 3×3).
- Overlays: grid, coords, solids, walkable, footprints/doors, bounds/tap hitbox, entrances & exits, markers, trees F/P, clearance, zones.
- Validate Map (connectivity, doors, entrances, exits, trees, clearance).
- Export/Import patch `wildlands-city-patch` v3 (deterministic JSON; v1/v2 import); patches never apply themselves to production.

## 10. Map dimension change (64×49 → 64×51)

The two rows are **appended at the south** (copies of the last forest row, street
under the south gate at x 8–13):

- Existing coordinates: unchanged (nothing shifts; appended rows only).
- Spawn (31,20), buildings, portals, arrivals: unchanged, except `gateS` footprint growing to d=7 over the new rows.
- Consumers: `TownArea.width/height` read the terrain length; bounds, collision,
  pathfinding and the minimap (`paintMinimap` centres any height ≤ 64) adapt.
  No production code hard-codes 49 rows. Tests that did: `atlas.test.ts` (now 51),
  `editorCamera.test.ts` (fit on 64×51) — both updated.
- Chunks/world: towns are not chunked; WildLands worlds are untouched.
- Saves: the only persisted position is `PlayerPreferences.townPosition` (browser
  `localStorage`). `isRestorableTownPosition` rejects solid/portal/door tiles and the
  game then uses the spawn, so positions inside the new footprints fall back safely.
  Nothing is persisted server-side for town positions.

## 11. Validation / QA (Validate Map on the frozen city)

- **0 errors**, 17 warnings, 1 info.
- Doors: all 6 entrances reachable from the spawn, exits walkable (Mercado, Swap, Dungeon, Pokédex, Perfil, Caja).
- Portals: the 5 exits reachable; arrivals walkable and visible.
- Warnings (all pre-existing in the original city except the Silph pocket):
  - isolated walkable pockets: 6 tiles at (8,0) and (50,0) (behind north gates), 20 at (6,14) and (57,14) (city edges), **16 at (36,7)** (behind Silph Co., new);
  - "no place to stand in front" of the 3 route gates (they are passages, not readable buildings);
  - a forest tree canopy over walkable (36,7);
  - 1-tile corridor on the spawn → Tundra path at (22,14);
  - 6 fences at y=7 on forest tiles, hidden in the trees.
- **Silph pocket (36–38, 7–12)** — accepted: inaccessible (fences + Silph Co. + apartments),
  visually covered by Silph Co., no props/NPCs/doors/portals, pathfinding simply finds
  no route to it.

## 12. Tests / build (on `87504b7`)

- Tests: **118 files, 1322 passed**.
- Typecheck (`vue-tsc -p tsconfig.app.json`): clean.
- Lint (`eslint .`): 0 errors, 9 pre-existing warnings (AuthModal).
- Build (`vite build`): OK; no lab code in `dist`; models ≈ 595 KB.

## 13. Conflict surface vs the main station (`feat/r33-stations-product @ 13de6b0`)

Files touched by both since `7c3af21`: `src/features/wildlands/engine/renderer.ts`
and `docs/wildlands/HANDOFF.md`. A dry-run `git merge-tree` of `r33` + `87504b7`
has **no textual conflicts**; typecheck is clean and **1716 tests pass** on that
combined tree (checked in a throwaway worktree, discarded).

| Area | This branch | Main station | Class |
|---|---|---|---|
| `renderer.ts` | model branch in `drawSprites`, `Drawable.model`, lamp glow | `collectPlacedHits` uses `placedFeet` | **likely clean** (different hunks; verified) |
| `docs/wildlands/HANDOFF.md` | door list lines | +2 lines | likely clean |
| `game.ts` | not touched | changed | clean |
| `placedObjects.ts` | not touched | changed (footprints) | clean; note: placed objects are world stations, towns have none |
| navigation / pathfinding | not touched | — | clean |
| area registry (`atlas.ts`) | not touched | — | clean |
| routes | DEV route added (`routes.ts`) | not touched | clean |
| `projection.ts` (`LensName` gains `town`) | changed | not touched | **possible semantic**: any code that maps every `LensName` (e.g. a lens cycle list or `Record<LensName,…>`) sees a new key; today `game.ts`'s `LENS_ORDER` omits it harmlessly |
| `townArea.ts`, `townProps.ts`, `chunks.ts` | changed | not touched | possible semantic only if the principal adds town props/decor fields (none found) |

No real semantic conflict found.

## 14. Recommended integration

**Merge this single consolidated branch** (or rebase it) onto the principal line
**after** `feat/r33-stations-product` lands, not cherry-picks:

1. The branch is cumulative and linear; cherry-picking would have to replay 27
   commits in order (lab → trees → fences → models) with intermediate states
   (commits 8–9) that are later superseded — more risk, no gain.
2. Porting by modules would duplicate the model pipeline, lab and assets by hand.
3. A dry-run against r33 is textually clean and passes typecheck + tests.

Sequence:

1. Land r33 on its target first.
2. `git merge --no-ff feat/town-3d-models` (or squash if a single commit is preferred;
   commits 8–9 carry no final value).
3. Run `vue-tsc`, `vitest`, `vite build`; open `/dev/city-lab` → PLAY and walk the
   six entrances and five exits.
4. Optional follow-ups (not required for integration): decide whether to keep the
   `condo` model asset (lab-only), whether the old building PNGs used only as model
   fallbacks should be replaced by the generated `*-sprite.png`, and the placed-tree
   `TownDef` slot.

Discard `feat/town-building-depth` (superseded).
