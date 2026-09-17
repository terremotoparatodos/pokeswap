# D1.1 — Dungeon Field Lab: visual / playable pass

Branch `feat/d1-1-dungeon-field-lab`, base `9a769f5` (D1).
Scope: turn what D1 built into something that *looks and plays* like the game,
without redefining any rule. No formula, stat, tier, loot table, Boss Skill or
economy number was touched.

The problem this phase answers, in the playtester's words: the lab felt like a
"boceto / representación técnica / debug UI" and not enough like a game, which
made it impossible to judge balance. So D1.1 is entirely presentation, input and
framing.

## 1. What visual infrastructure was reused

Everything that makes the dungeon look like PokeSwap comes from the **WildLands
engine**, consumed read-only. Nothing in `src/features/wildlands/` was modified.

| Reused | From | Used for |
| --- | --- | --- |
| `shade()`, `ellipses()`, `capsules()`, `layer()`, `spriteFromPixels()` | `wildlands/engine/sprite.ts` | every cave tile, the chest, the Poké Ball, the fallback blob |
| `loadOverworldFrames(id, shiny)` | `wildlands/engine/characters.ts` | the **real bundled overworld sheets** for every wild Pokémon, ally and Alpha |
| `buildTrainer(PLAYER_PALETTE)` | `wildlands/engine/characters.ts` | the player sprite, with the same four-direction walk cycle as the overworld |
| `Dir`, `Sprite`, `PokemonFrames` types | same | so the prototype speaks the engine's vocabulary instead of inventing one |

The isolation test (`components/dungeonRoute.test.ts`) now encodes this as a
rule: a prototype file may import from `../../wildlands/engine/` and from
nowhere else outside its own namespace, and **every** WildLands import must
contain `/engine/`. The legacy `features/dungeon/` ban from D0 is unchanged.

## 2. What could not be reused, and why

`wildlands/engine/renderer.ts` renders a **perspective overworld from an
`Area`**: chunks, decor instances, a projector, lighting and weather. A dungeon
floor is a procedural top-down grid with no `Area` behind it. Reusing it would
have meant either faking a whole `Area` per floor (and per floor change) or
refactoring the production renderer — and refactoring the productive renderer is
explicitly out of scope.

So `render/dungeonRenderer.ts` is a small prototype-local top-down renderer
(2D grid, camera, z-sorted entities, VFX layer). It reuses the engine's *sprite
recipe* and its *sheets*; it does not reuse its *scene graph*. That is the single
piece of visual infrastructure that is duplicated, and it is the one worth
revisiting if the dungeon is ever promoted out of the prototype namespace.

## 3. The files this phase added

```
render/tileArt.ts             seven biome palettes, shaded cave tiles, chest, ball, blob
render/dungeonSprites.ts      trainer + species sheets, facing, async load with a blob fallback
render/dungeonRenderer.ts     top-down canvas renderer + 18 VFX kinds
components/DungeonStage.vue   canvas host: camera easing, keyboard, floating d-pad
components/BattleHud.vue      compact combat HUD (foe, A/B allies, moves, bag, switch)
components/DungeonCatalog.vue one card per entrance instead of a form
components/DevTools.vue       every technical control from D1, collapsed, emit-only
domain/playSession.test.ts    16 tests over the flows the lab actually drives
```

`PlayDungeon.vue` became the orchestrator: it owns the session (single writer),
the monotonic visual clock, the log-to-VFX translation, the expedition HUD, the
contextual CTAs, the antechamber, the endings and the DEV commands.

## 4. The two-Pokémon UX choice (and what was discarded)

Solo against the Alpha the run fields **two active Pokémon**, which is a D1 rule,
not a D1.1 one. The question D1.1 had to answer was how to show two of them at
once on a phone.

**Chosen:** one visible bar per ally, always, plus **A / B tabs** that switch
which ally the move grid is driving. The inactive tab flashes when that ally's
action bar fills, so the player is pulled to it instead of having to poll.

Discarded:

- **Two full move grids stacked.** Honest, but at 375 px it pushes the world off
  screen and the fight becomes a spreadsheet. Rejected: the whole point of the
  phase is that the world must stay visible.
- **Auto-piloting the second Pokémon.** Least UI, but it hides half the combat
  from the player and would make any future balance reading meaningless.
- **A single "next ready" slot that swaps itself.** Fewest taps, but the target
  changes under the player's thumb mid-tap. Rejected as actively hostile in a
  real-time fight.

## 5. Known visual problems

- **The renderer is duplicated infrastructure** (section 2). Acceptable for a lab,
  a liability if this ships.
- **Species sheets load asynchronously.** For the first frames after a floor
  loads, a Pokémon can render as its coloured fallback blob before its sheet
  arrives. `preloadSpecies()` hides this in practice, but a cold cache on a slow
  connection will still show it.
- **No tile transitions.** Rock meets floor with a lip and a shadow, but there
  are no corner or edge variants, so long straight walls look repetitive.
- **The camera snaps on a floor change** by design (a floor change is a jump, not
  a walk) — but there is no transition covering the snap, so it reads as a cut.
- **No ambient life.** Water does not animate, torches do not flicker, and wild
  Pokémon idle in place rather than wandering. The floor is static between the
  player's own actions.
- **The d-pad overlaps the world.** It floats over the bottom-left of the map and
  is hidden during combat, which is the right trade at 375 px but does cover
  tiles while exploring.
- **DEV TOOLS redraws on a token, not on the session.** The session is a
  `shallowRef` mutated in place, so the debug panel is refreshed four times a
  second plus once when the run ends. Correct, but a seam worth removing if the
  session ever becomes a proper store.

## 6. Verified in the browser

Catalog to entrance card to run; walking and collision; adjacency CTA; in-map
combat with damage numbers, status chips and the Protect ring; the key HUD going
from `—` to `CONSEGUIDA` and the door CTA turning `ABIERTA`; floor change keeping
HP/PP; the antechamber sheet (party, items, countdown, "acá no se cura nada");
the **boss room** with the Alpha at ×2, its pulsing red aura, two allies and the
A/B tabs; all three endings (EQUIPO DEBILITADO, EXTRACCIÓN COMPLETA, retreat
confirmation); 375 px with no horizontal scroll on both the explore and the
combat screens.

Not driven end-to-end in this pass, left for the human playtest: throwing a ball
at a wild Pokémon in the field (the ball and shake VFX themselves are exercised
by the switch-in animation), opening a chest in the field, and the natural expiry
of a three-hour dungeon at ×1 speed.

## 7. Things that felt potentially bad — documented, not redesigned

Per the phase contract these are **not** changed here:

- **The action bar is fast enough that two allies feel like a reflex test.** Solo
  against the Alpha, both bars fill inside ~3 s of each other and the A/B tab
  flash competes with the boss telegraph for the same attention.
- **No sustain on a floor means the run is decided by floor 3–4.** The party
  arrives at floor 16 on whatever is left, and the antechamber deliberately heals
  nothing. That is the design, but in play it reads as "the last twelve floors
  are a formality or a loss".
- **The key is invisible until it drops.** Nothing on the floor tells the player
  which encounter carries it, so clearing a floor is the only strategy.
- **Alpha effective power ≈ 4.08×** makes the boss a wall rather than a fight
  when the party arrives worn. Worth a number pass, not a redesign, after
  playtest.

## 8. Out of scope, untouched

`main`, `integration/r31`, the production renderer, WildLands, the legacy
`features/dungeon/`, networking, server, Supabase and real persistence. The
prototype stays behind the `import.meta.env.DEV` guard at `/dev/dungeon`; a
production build contains none of it (verified by grep over `dist/`).
