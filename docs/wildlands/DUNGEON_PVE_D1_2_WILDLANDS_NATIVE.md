# D1.2 — WildLands-native dungeon visual integration

Branch `feat/d1-2-dungeon-wildlands-visual`, base `b8bd725` (D1.1).
Scope: change how the dungeon is **presented**, not what it is. No formula,
stat, tier, loot table, Boss Skill, capture chance or economy number moved.

The answer to the playtest, in one line: **PLAY DUNGEON now runs on the real
WildLands renderer.** The floor is an `Area`, the trainer and every Pokémon are
`Actor`s, and the fight happens on the floor tile where the Pokémon was
standing.

## 1. The adapter

`world/dungeonArea.ts` — `class DungeonArea implements Area`.

The engine's renderer only ever talks to the `Area` interface, so a dungeon
floor only has to answer the same fifteen questions a world answers:

| `Area` member | What the dungeon gives it |
| --- | --- |
| `kind: 'wild'` | so the renderer paints its **animated water** under the floor |
| `lens: 'handheld'` | the same camera the overworld uses |
| `drawGround` | one baked bitmap per floor, sampled from real 64px terrain textures; water tiles stay transparent; a dark rim where floor meets rock |
| `decorIn` | real `buildPropSprites()` rocks, boulders, ice rocks, pines and crystals on the wall edges, plus wall torches that emit light |
| `isSolid` / `isWater` | the floor's own `TileKind` |
| `arrival`, `placeName`, `paintMinimap`, `weather`, `collect`, `talkAt`, `createPopulace`, `tick` | trivial, or empty because the dungeon owns its own actors |

Everything past the edge of the floor is filled with the rock texture, so the
cave does not open onto an ocean.

**No production file was modified.** `git diff b8bd725 --stat` touches only
`src/features/dungeonPrototype/` and `docs/`.

## 2. Does PLAY DUNGEON really use the WildLands pipeline?

Yes. `components/WildStage.vue` builds a `Scene` and calls
`new Renderer(canvas).render(scene, dt)` — `src/features/wildlands/engine/renderer.ts`,
unmodified. That means the dungeon gets, for free and identically to the
overworld: the tilted projection, the ground buffer, projected silhouette
shadows, depth sorting, the day/night multiply tint, the player's lantern glow,
the vignette and the animated water.

The D1.1 prototype renderer still exists and is reachable from **DEV TOOLS →
Motor → "Comparar con el render D1.1"**. It is a comparison tool, not the
experience.

## 3. The fight happens in the dungeon

`world/combatStaging.ts` (pure, tested) and `world/dungeonScene.ts`:

- the wild Pokémon **is** the actor that was already standing on the floor —
  `openCombat` returns that same object, and the tests assert identity, so the
  foe can never be duplicated;
- our Pokémon are placed on free walkable ground next to the foe, never in rock,
  never on water, never on top of anybody;
- the trainer keeps their tile, stays on screen, turns to face the fight and
  stops walking until it ends (`locked`);
- when it ends, our Pokémon are recalled, the trainer walks again and a defeated
  or captured Pokémon is simply gone from the floor.

The one exception the code makes: on the last floor the Alpha stands on the
stairs, which is exactly where a floor change drops the player. `stepOffOccupied`
moves the trainer **one** tile off it — one tile, because the rules only let you
interact with something you are adjacent to, so two would have made the Alpha
unfightable. That is a placement fix, not a rule change.

## 4. The HUD moved into the world

`render/worldOverlay.ts` implements the engine's own `SceneOverlay` port (the
one the mining prototype already uses), so none of this needed a renderer change:

- **HP bar, action bar and status pip float over each Pokémon**, projected and
  scaled with the scene — the Alpha's are twice the size, like the Alpha;
- **damage and healing numbers** are canvas labels at the world position of
  whoever was hit;
- **attack effects** are one shape in the move's **type colour**: a burst for a
  physical hit, a travelling burst for a special, a soft aura for a status, a
  blue dome for Protect, a wide ring for a Boss Skill;
- **the Alpha's aura** is drawn on the ground, so the camera tilts it with the
  floor;
- **Poké Balls** arc from the trainer, open, flash, and the Pokémon appears.

What is left in DOM is deliberately small (§11, §27): one thin expedition line
above the world, and a 232px `CombatPopup` in a corner with the foe's name and
HP, our name and HP, four moves, Cambiar and Mochila.

## 5. Assets

**Reused, unchanged, from WildLands:** the terrain textures (grass, tall grass,
sand, dune, snow, animated water), `buildPropSprites()` (tree, pine, snowpine,
bush, rock, boulder, icerock, crystal, cactus, drybush), `buildTrainer(PLAYER_PALETTE)`,
the real bundled overworld sheets for every Pokémon, and the whole sprite recipe
(`shade`, `ellipses`, `capsules`, `fromAscii`, `spriteFromPixels`).

**New, built in the same language** (`world/dungeonProps.ts`, `world/dungeonTerrain.ts`):
cave rock and cave floor textures (seamless 64px, 4 tones, ordered dither, exactly
how `terrainArt.ts` builds its own), bridge planks, a chest closed and open, a
stairway, a door locked and open, a wall torch (two frames), a cave mouth, a
Poké Ball, the health/action bars and the status pips. No blobs, no wireframes,
no debug icons: the fallback for a sheet that has not loaded yet is the same
Poké Ball the production lobby uses.

**Biomes** keep the seven themes, but each one is now a palette over the same
material system, and it borrows the engine's material wherever one exists —
glacier floors are real snow, forest floors real grass, ruins real sand,
volcanic floors a basalt crust with hot cracks.

## 6. The dungeon entrance

`components/EntranceArt.vue` draws a small strip of simulated overworld on every
catalog card: real ground texture for that biome, real props, the cave mouth, and
the trainer walking into it. It is not wired into the real overworld — that is
integration, and integration is not this phase — but the step from WildLands into
a Dungeon can now be looked at.

## 7. Verified in the browser

Desktop: catalog with a real entrance per biome → enter → cave drawn by the
WildLands renderer with rock walls, torch light, the player's lantern, real
water and a tilted camera → walk with keys and the d-pad (which greys out the
directions that are blocked) → stand next to a Pokémon → CTA → fight **on the
tile**, trainer visible, one foe, our Pokémon out of a Ball, HP bars over both,
damage numbers, hit rings → win → the Pokémon is gone and control returns →
chests and the stairway door as real props → last floor with the Alpha at ×2 and
its aura → antechamber → boss fight with A/B tabs and both allies' bars.

375 px: the world keeps most of the screen, the d-pad is 48px, the combat popup
is ~214px in the corner and the world is never covered.

## 8. What still feels like a prototype

- **The boss room is not a room.** It is the last floor's stairs tile. The Alpha
  is there at ×2 with its aura, but §20's "big clean room with danger marks" is
  not built — the floor generator would have to know about a boss chamber, and
  that is generation, not presentation.
- **Fights against ordinary wild Pokémon are over in a few seconds**, which makes
  the combat visuals hard to even see. That is balance, documented not changed.
- **Everything clusters on two or three tiles.** The rules put the trainer next
  to the foe and our Pokémon between them, so at 16px tiles the three of them
  overlap. It reads, but it is tight.
- **The floating bars sit high** over big sprites, because the lift is derived
  from the sprite height and then projected.
- **The wall is rocks, not a wall.** There is no cliff-face art in WildLands, so
  a dungeon wall is dark rock ground plus real boulders. It reads as a cave, but
  a real wall tile would read better.
- **No transition** between the overworld strip and the dungeon, and none on a
  floor change.
- **The prototype renderer is still in the tree.** It is a DEV comparison now;
  it should be deleted once the new one has been played enough.

## 9. Untouched

`main`, `integration/r31`, `src/features/wildlands/` (read-only), the legacy
`src/features/dungeon/`, professions, networking, authority, Supabase and real
persistence. `/dev/dungeon` stays behind `import.meta.env.DEV`; a production
build contains none of it (grep over `dist/` returns 0 for every new file).
