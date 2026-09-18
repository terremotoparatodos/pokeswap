# D1.2.1 — Dungeon = WildLands in cave mode

Branch `feat/d1-2-1-dungeon-wildlands-cave`, base `f25e67e` (D1.2).
Combat was not touched. This phase is exploration only.

The rule: the dungeon must feel almost identical to WildLands in camera, scale,
movement, player, tiles and composition. The only difference should be that we
are underground.

## 1. The player is the same object

`engine/game.ts` builds its player as
`createActor({ id: 'player', kind: 'player', habitat: 'any', trainer: renderer.playerSprites })`
and then dresses it with `PlayerAppearance` + `playerCharacter(DEFAULT_PLAYER_CHARACTER_ID)`,
which loads `/assets/trainers/protahombre.png` (walk columns 0–3, run columns 4–7).

The dungeon now does exactly that, line for line. Before D1.2.1 it used
`habitat: 'land'`, id `'trainer'`, and only the code-drawn `buildTrainer`
fallback — which is why the character looked different. The drawn trainer is
still there, as the fallback it is in the overworld.

`identity/playerCharacters` is the one non-engine WildLands module the prototype
may import; the isolation test names it and says why.

## 2. The camera is the same rule

| | WildLands | Dungeon before | Dungeon now |
| --- | --- | --- | --- |
| lens | `LENSES[area.lens]` = `handheld` (zoom 3, squash 0.74, distance 900) | handheld | handheld |
| focus row | `H * 0.56` (renderer) | same | same |
| small-screen fit | `clamp(min(w,h)/640, 0.55, 1)` (renderer) | same | same |
| follow | **locked** to `actorPosition(player)`; eases only when the gap > 3 tiles, at `1 - e^(-dt·10)` | eased every frame at `min(1, dt·9)` | locked, same rule |

The old camera lagged behind every single step. That is the "la cámara se siente
rara". It is gone.

## 3. Movement is the same code

- speed latched per tile while standing: `(sprint ? RUN_SPEED : WALK_SPEED) × (water ? 0.7 : 1)` — 3.75 / 7.5 tiles per second, exactly the overworld's;
- `driveWalker` with the same `WalkerState`: turn-then-step from standing, no stall between tiles, walking in place against a wall;
- input is the engine's own `KeyboardInput`: held keys stack and the last wins, Shift runs, the d-pad feeds `virtualDir`, E/Space interacts. Before, the dungeon had its own one-key handler and no run.

## 4. Tile scale

Unchanged and unchangeable: `TILE = 16`, the overworld's. What changed is how
many of them a dungeon gets.

## 5. Space: before vs now

| | before | now |
| --- | --- | --- |
| plan cell | 9 × 7 tiles | **22 × 17** |
| room | rectangle, `max(3, w·2) × max(3, h·2)` | **organic chamber**, 4–7 overlapping discs, never under 9 across |
| corridor | **1 tile** (2 when the roll said "wide") | **5 tiles** on a main route, **4** on a branch |
| pinch points | the structure | only bridges, at 2 tiles |
| loops | none | one extra link per four rooms |

**Minimum width, measured (§7).** A trainer is one tile. Four trainers with a
Pokémon each is eight bodies, and a fight parks three of them abreast. So:
`PATH_WIDTH = { main: 5, side: 4, pinch: 2 }`, exported as a playtest parameter.
The tests measure the real output: across five seeds, **under 5 % of walkable
tiles are narrower than 4**, and the **median open width is ≥ 5**. The comparison
tool prints the same numbers live (typically median 28–31 in a chamber, 0 % narrow).

## 6. Hiding the room graph

The plan layer (`floorPlan.ts`) is **untouched** — same seed, same rooms, same
links, same encounters, same determinism (§14). Only `buildFloorTiles` changed:

1. **routes are carved first**, as discs stamped along a cubic Bézier with two
   jittered control points, so a passage bends;
2. **chambers are carved second**, as unions of discs, so they open onto ground
   that is already there instead of meeting it at a doorway;
3. extra loops connect neighbouring rooms the plan did not link;
4. gravel and biome patches are weathered over the result;
5. a lake with a bridge;
6. a connectivity repair pass: whatever the entrance cannot reach gets another
   gallery carved to it with the same tool, so a lake can never cut the floor in
   two (this was a real bug on seed 11 and is now a test).

Nothing in the output is a rectangle, and no corridor meets a room at a door.

## 7. Biomes

Seven, unchanged: `cave` base plus `mine`, `glacier`, `forest`, `volcano`,
`ruin`, `tower`. What changed is that a biome patch is now a **real overworld
material** wherever one exists: forest floors are the engine's grass with tall
grass patches and its trees, pines and bushes; glacier is its snow with ice rocks
and crystals; ruins its sand and dune; cave and mine get sand patches over cave
rock; volcanic keeps the basalt crust. Water is the engine's own animated water,
painted under the floor exactly as it is in a world.

## 8. Props

- **chests** go in a nook: a walkable tile touching one or two walls, never on a
  tile narrower than a pinch. A test asserts every chest has a wall beside it;
- **the stairway** takes the most open tile of its chamber (score = walkable
  tiles within a 5×5 window), so there is room to stand in front of it. A test
  asserts at least 18 of the 25 tiles around it are clear;
- **encounters** go on ground wider than a pinch, so a Pokémon standing there
  can be walked around — tested.

## 9. The comparison tool (§16)

DEV tab **"Comparar con WildLands"**: two viewports the same size, one running
the real `engine/world.ts` generator through a `SampleArea`, one running a
dungeon floor, both with their own player built the same way and dressed with the
same sheet, both on the same camera rule — and **one set of keys driving both at
once**. Any difference in scale, projection or pace shows up as the two halves
disagreeing. Seven theme buttons and a reroll, plus the live width measurements.

It is a development aid and should be deleted when it stops being useful.

## 10. Acceptance (§17), answered honestly

- **Player — is it visually the same?** Yes. Same actor fields, same sheet, same
  animation; the comparison tool shows one character in both halves.
- **Camera — does it feel the same?** Yes. Same lens, same focus row, same fit,
  same follow rule, verified by driving both halves with one keypress.
- **Movement — does it feel the same?** Yes. Same speeds, same walker, the
  engine's own input object.
- **Scale — is it the same?** Yes. Same `TILE`, same lens; the player is the same
  size on both sides of the comparison.
- **Space — could four players circulate?** Yes by the numbers: median ≥ 5 tiles,
  under 5 % below 4, bridges the only pinch. Not yet confirmed by four humans.
- **Biomes — do they read as WildLands?** Forest, glacier and ruins do: they are
  literally the engine's materials and props. Cave, mine and tower are darker
  cousins of the same system.
- **Props — do they look like the same game?** Rocks, trees, ice and crystals do,
  because they are the engine's. The chest, door and stairway are still
  prototype art, correctly placed but not final.

## 11. What still feels different from WildLands

- **The cave is dark** and the overworld is not. That is the point, but it also
  flattens the biome patches: snow and grass read greyer than they do outside.
- **Water under cave light reads flat.** It is the same animated water, tinted.
- **Walls are boulders, not cliffs.** §11 said not to spend the phase on walls,
  and this is the cost: the boundary reads as "a lot of rocks" and not as rock
  face. It is the biggest remaining gap.
- **Nothing lives here.** WildLands has a populace wandering; dungeon Pokémon
  stand still because the rules pin them to a tile.
- **Chambers can be very large** now — the median width of 28 in a hall is more
  space than the overworld usually gives at once.
- **No ceiling, no depth cue overhead**, so a big chamber can feel like an open
  field at night rather than a cavern.

## 12. Untouched

Combat in every respect (HUD, action bar, moves, damage, status, capture, Alpha,
Boss Skills, bag, switch), `main`, `integration/r31`, `src/features/wildlands/`,
the legacy `src/features/dungeon/`, professions, networking, Supabase. The
prototype stays behind `import.meta.env.DEV`; a production build contains none of
it.
