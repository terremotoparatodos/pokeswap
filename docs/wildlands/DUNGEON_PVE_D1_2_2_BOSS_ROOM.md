# D1.2.2 — Navigation polish + Boss Room

Branch `feat/d1-2-2-dungeon-boss-room`, base `fc910c2` (D1.2.1, approved).
Combat was not touched. This phase closes exploration and builds the room the
Alpha fight will happen in.

## 1. Running

Desktop keeps Shift, because it is the engine's own `KeyboardInput` that reads
it. Mobile gets one button, **CORRER**, next to the d-pad: held like Shift, not
a toggle, so it cannot be left on by accident and nothing new has to be
remembered. It sets the same `sprinting` flag the keyboard sets. Speeds are
untouched (`WALK_SPEED` 3.75, `RUN_SPEED` 7.5 tiles/s).

## 2. Click-to-move

**Audited first, and the infrastructure already existed:** `engine/pathfinding.ts`
(bounded A* over the tile grid) and `engine/navigator.ts` (`TapNavigator`: plans,
feeds the walker one direction at a time, re-plans when something steps into the
way, flashes a red cross on an unreachable tap, and reports when the walk ended
next to something worth talking to). The dungeon reuses both. Nothing was
reimplemented; the only new code is the wiring:

- `DungeonWorld` owns a `TapNavigator` whose collision test is the dungeon's own
  `isSolid`;
- a pointer on the canvas becomes `Renderer.pick(x, y)` and goes straight to it;
- the update order is the overworld's: a pressed direction cancels the route,
  `driveWalker` runs with `instantTurn` while navigating, and the route marker
  is drawn by the renderer because the scene now passes `route: scene.route()`;
- a fight cancels the route and refuses new ones;
- arriving beside something fires the same `interact` the E key fires.

## 3. Walkable rocks — fixed

The cause was structural: props were drawn from one list and collision read a
different one (only the tile kind), so a boulder was scenery you could walk
through.

`domain/decorPlan.ts` is now the single decision. It is pure — no canvas, no
sprites — and returns, for every prop, its tile, its kind and whether it blocks.
`DungeonArea` builds its sprites from that list *and* its blocked set from the
same list, so what is drawn and what blocks can no longer disagree.

**The audit, in full:**

| Solid | Decor |
| --- | --- |
| rock, boulder, tree, pine, snowpine, palm, cactus, drybush, bush, icerock, searock | torch, shell, coral |
| **crystal** — the overworld treats it as a pickup you walk over; in a cave it is a formation the size of a person, so here it blocks | |

A prop may only stand on walkable ground where `openWidth` still exceeds a main
route, and never on the spawn, the exit, the stairs or a bridge — so making
things solid cannot narrow a route.

## 4. Chest

New art: a rounded wooden case banded in gold, white-and-red lid, round clasp —
the Poké Ball read without being one. Closed and open states. Placement is
unchanged (D1.2.1 approved it).

**Glow:** an unclaimed closed chest breathes a soft warm light, a slow sine that
never exceeds ~0.57 alpha on a 10px sprite, so it is findable across a hall and
is not a lamp. An opened chest has none. Loot is untouched.

## 5. Stairway

Redrawn as a landing seen from directly above: a square frame cut into the floor
with the steps running down it as concentric bands that darken toward the middle.
That is the reading the handheld dungeon crawlers made famous; this is an
original, generated drawing of it — no asset was copied.

- **LOCKED**: a stone slab with a keyhole over the opening.
- **OPEN**: the steps, plus a slow glint from the same glow the chest uses.

It is anchored above its feet so it lies flush with the ground, and it casts no
body shadow. Spawns and stairways no longer land on a bridge.

## 6. Cave Style A / Style B

`CAVE STYLE A` is the approved base and is untouched and still the default.
`CAVE STYLE B` is the same floor, dressed: denser props along the walls (0.78 vs
0.55) and a few formations just off the edge of a room. It changes **no** tile —
a test asserts the ground array is identical — and every extra prop must still
sit on ground wider than a main route, so navigation is provably the same.

Both are selectable in **Comparar con WildLands**, alongside the seven biomes
and a reroll, so the two can be judged side by side against the overworld.

## 7. Boss Room

`domain/bossRoom.ts`, pure and deterministic. The generator now routes the last
floor there instead of building a procedural one (`plan.difficulty.isBossFloor`).

**Shape:** an antechamber (oval, 9×7 radii) → a corridor five tiles wide → a
door → the hall (oval, 17×12 radii, so 34×24 tiles). The middle 10-tile radius
is kept clear of decor; the ring outside it carries the biome's patches.

**Biome:** inherited from the `DungeonDefinition.theme`, so the hall is painted
and propped with the same materials as the rest of that dungeon — a test asserts
every theme produces accent ground in the hall.

**Slots (§14), explicit and tested:**

| | where |
| --- | --- |
| Alpha | 4 tiles north of the hall centre — never the door, never a spawn, never the stairs |
| trainers ×4 | a row 3 tiles inside the door, spread at −6, −2, +2, +6 |
| allies ×4 | a row 7 tiles inside the door, between their trainer and the Alpha |
| door / approach | the gap in the hall's south rim, and the tile in front of it |

`placeEntities` puts the Alpha on its slot, and `DungeonWorld.openCombat` uses
the trainer and ally slots directly when the fight is the boss fight.

**Antechamber (§12):** a real space you walk into. The door is visible from it,
the prompt appears on the approach tile, and the existing sheet still lists the
party, HP, faints, Potions, Revives, Ethers, the countdown and the ready state.
It heals nothing.

**Door (§13):** closed while you are outside, open while you are committing in
the antechamber, closed again once the fight begins. Representation only; no
escape rule was added.

**Alpha (§15):** visible from the moment you enter, at ×2, with its aura, idle.
The fight still starts on the trigger.

## 8. Verified by hand

Desktop: enter → walk → run (Shift) → click a tile and the trainer walks there →
walk into rocks and be stopped → find a glowing chest → open it → key → the new
stairway landing, sealed then open → next floor → the boss corridor and its
closed door → antechamber → the hall with the Alpha, the trainer in their slot
and both allies out.

375 px: the same, with CORRER beside the d-pad, no horizontal scroll, and the
geometry unchanged — only the camera zooms out.

## 9. Still open

- **A species sheet that fails to load leaves the Poké Ball fallback**, which at
  ×2 makes the Alpha a large ball until it arrives. Correct behaviour, ugly for
  the two seconds it lasts.
- **The stairway is small** against a 22-tile-wide hall; it reads at walking
  distance but not from across a chamber.
- **Walls are still boulders.** §11 of D1.2.1 deferred this and it is still the
  biggest visual gap.
- **Style B is a first pass**: denser, but it does not yet suggest a ceiling or
  add real columns.
- **The boss hall has no danger marks** on the floor yet.

## 10. Untouched

All of combat (HUD, action bar, moves, damage, status, capture, Alpha values,
Boss Skills, bag, switch), `main`, `integration/r31`, `src/features/wildlands/`,
the legacy `src/features/dungeon/`, professions, networking, Supabase.
