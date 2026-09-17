// The dungeon as a WildLands scene (D1.2 §2, §8, §9, §10, §17).
//
// One trainer actor, one actor per wild Pokémon on the floor, and one actor per
// Pokémon we send out — all of them ordinary engine `Actor`s in one `Area`, so
// the renderer draws, shadows, lights and depth-sorts them exactly like the
// overworld does.
//
// The rules of the fight are not here: this only decides *where* things stand
// and *which way* they look. A wild Pokémon that is fighting is the same actor
// that was standing on the floor a second earlier — the fight never makes a
// second copy of it.

import {
  actorPosition, advance, createActor, createWalkerState, driveWalker, isMoving,
  RUN_SPEED, WALK_SPEED, type Actor, type MoveRules,
} from '../../wildlands/engine/actors'
import { PlayerAppearance } from '../../wildlands/engine/playerAppearance'
import { DEFAULT_PLAYER_CHARACTER_ID, playerCharacter } from '../../wildlands/identity/playerCharacters'
import type { Lighting } from '../../wildlands/engine/atmosphere'
import type { Dir, TrainerSprites } from '../../wildlands/engine/characters'
import { TILE } from '../../wildlands/engine/world'
import { isWalkable, type FloorEntity, type FloorTiles, type TilePoint } from '../domain/floorTiles'
import { speciesById } from '../data/speciesFixtures'
import { speciesFrames, preloadSpecies } from '../render/dungeonSprites'
import { isBossFloor } from '../domain/bossRoom'
import { DungeonArea, DUNGEON_DARKNESS } from './dungeonArea'
import { TapNavigator } from '../../wildlands/engine/navigator'
import type { Pick as ScenePick, RouteMarker } from '../../wildlands/engine/renderer'
import { facingBetween, openGround, stageCombat } from './combatStaging'

/** Underground light: dim ambient plus the renderer's own lantern on the player. */
export function caveLight(theme: string): Lighting {
  const warm = theme === 'volcano'
  const icy = theme === 'glacier'
  return {
    phase: 'Noche',
    tint: warm ? [186, 150, 138] : icy ? [168, 186, 210] : [150, 158, 190],
    darkness: DUNGEON_DARKNESS,
    shadow: { dx: -0.3, dy: 0.34, alpha: 0.3 },
  }
}

export interface AllyActor {
  readonly actor: Actor
  /** Which battle combatant this sprite belongs to. */
  readonly combatantId: string
}

export class DungeonWorld {
  area: DungeonArea
  readonly player: Actor
  /** Wild Pokémon standing on the floor, by entity id. One actor each, always. */
  private readonly wild = new Map<string, Actor>()
  private readonly allies = new Map<string, Actor>()
  private readonly walker = createWalkerState()
  /** Loads the same character sheet the overworld puts on the player. */
  private readonly appearance: PlayerAppearance
  /** The Alpha is drawn at twice the size by the overlay, so it is not a plain actor. */
  private alphaId: string | null = null
  /** Tap-to-move, the overworld's own navigator (D1.2.2 §4). */
  private readonly nav: TapNavigator
  /** True on the frame the tap route finished next to something to interact with. */
  arrivedAtTarget = false
  /**
   * Tiles an unbroken obstacle is sealing (D1.2.4 §1). The scene has to know:
   * otherwise a tap route is planned straight through a rockfall and the walk
   * stops dead against something the pathfinder thought was open.
   */
  private sealed: ReadonlySet<string> = new Set()
  /** Set while a fight is on: the trainer keeps their tile and stops walking. */
  locked = false
  /**
   * Set while the Alpha fight is staged (D1.2.4 §3). The Boss Room puts the
   * Alpha thirteen tiles ahead of the trainer, which is more than the handheld
   * lens can hold: framed on the trainer alone the boss is simply off screen.
   * While this is on, and only while it is on, the camera looks at the middle
   * of the arena instead. Exploration keeps the overworld's rule untouched.
   */
  bossFraming = false
  camX = 0
  camY = 0

  constructor(trainer: TrainerSprites, tiles: FloorTiles, entities: readonly FloorEntity[], at: TilePoint, seed: number, floor: number) {
    this.area = new DungeonArea(tiles, seed, floor)
    // D1.2.1 §2: the same actor WildLands makes, field for field — the same id,
    // the same `habitat: 'any'`, the same drawn fallback, and the same character
    // sheet loaded over it by PlayerAppearance. Nothing about the player is
    // "the dungeon's version of" anything.
    this.player = createActor({
      id: 'player', kind: 'player', habitat: 'any', tx: at.x, ty: at.y, trainer,
    })
    this.nav = new TapNavigator({
      isSolid: (tx, ty) => this.area.isSolid(tx, ty) || this.sealed.has(`${tx}:${ty}`),
      occupied: (tx, ty) => this.actorsIncludingAlpha().some(actor => actor.tx === tx && actor.ty === ty),
    })
    this.appearance = new PlayerAppearance(this.player, trainer)
    this.appearance.set(playerCharacter(DEFAULT_PLAYER_CHARACTER_ID))
    this.syncWild(entities)
    const home = actorPosition(this.player)
    this.camX = home.x
    this.camY = home.y
  }

  /** Swaps in a new floor: a new area, new wild actors, and the player placed. */
  loadFloor(tiles: FloorTiles, entities: readonly FloorEntity[], at: TilePoint, seed: number, floor: number): void {
    this.area = new DungeonArea(tiles, seed, floor)
    this.wild.clear()
    this.allies.clear()
    this.locked = false
    this.place(at)
    this.syncWild(entities)
    const home = actorPosition(this.player)
    this.camX = home.x
    this.camY = home.y
  }

  /** What the obstacles are currently closing. Cleared ones simply drop out. */
  setSealed(tiles: ReadonlySet<string>): void {
    this.sealed = tiles
  }

  place(at: TilePoint): void {
    this.player.tx = at.x
    this.player.ty = at.y
    this.player.fromTx = at.x
    this.player.fromTy = at.y
    this.player.progress = 1
  }

  /** One actor per Pokémon still on the floor; cleared ones disappear. */
  syncWild(entities: readonly FloorEntity[]): void {
    const alive = new Set<string>()
    preloadSpecies(entities.filter(e => e.speciesId).map(e => e.speciesId!))
    for (const entity of entities) {
      if (entity.kind === 'chest' || entity.taken || !entity.speciesId) continue
      alive.add(entity.id)
      if (entity.isAlpha) this.alphaId = entity.id
      const existing = this.wild.get(entity.id)
      if (existing) continue
      const species = speciesById(entity.speciesId)
      this.wild.set(entity.id, createActor({
        id: `wild-${entity.id}`,
        kind: 'pokemon',
        habitat: 'land',
        tx: entity.at.x,
        ty: entity.at.y,
        dir: 'down',
        pokemon: { id: entity.speciesId, name: species?.name ?? 'Pokémon', shiny: false, frames: speciesFrames(entity.speciesId) },
      }))
    }
    for (const id of [...this.wild.keys()]) if (!alive.has(id)) this.wild.delete(id)
    if (this.alphaId && !alive.has(this.alphaId)) this.alphaId = null
  }

  /**
   * A floor change drops the player on the stairs, and on the last floor the
   * Alpha is standing on exactly that tile. Two bodies on one tile look wrong
   * and, worse, the rules only let you talk to something you are *next to* —
   * so the player would be staring at a Pokémon they could not fight. One step
   * back fixes both. Returns the new tile when it moves.
   */
  stepOffOccupied(tiles: FloorTiles): TilePoint | null {
    const here = { x: this.player.tx, y: this.player.ty }
    const sharing = [...this.wild.values()].some(actor => actor.tx === here.x && actor.ty === here.y)
    if (!sharing) return null
    const busy = [...this.wild.values()].map(actor => ({ x: actor.tx, y: actor.ty }))
    // One tile, not two: the player must still be *next to* what they stepped
    // off, or the rules would not let them interact with it at all.
    const spot = openGround(tiles, here, busy, { x: here.x, y: here.y + 1 })[0]
    if (!spot) return null
    this.place(spot)
    return spot
  }

  /** Refreshes frames for sheets that finished loading after the actor was made. */
  refreshFrames(): void {
    for (const actor of [...this.wild.values(), ...this.allies.values()]) {
      if (actor.pokemon) actor.pokemon.frames = speciesFrames(actor.pokemon.id)
    }
  }

  /** Everything that occupies a tile, the Alpha included. */
  private actorsIncludingAlpha(): Actor[] {
    return [...this.wild.values(), ...this.allies.values()]
  }

  /**
   * Tap-to-move (§4). Hands the renderer's pick straight to the overworld's
   * navigator; it refuses anything unreachable and flashes a cross instead.
   */
  goTo(pick: ScenePick): boolean {
    if (this.locked) return false
    return this.nav.goTo(this.player, pick)
  }

  /** The tap marker the renderer draws on the ground. */
  route(): RouteMarker {
    return this.nav.route(this.player)
  }

  /** The Alpha actor: it blocks and is targeted, but the overlay draws it. */
  get alphaActor(): Actor | null {
    return this.alphaId ? this.wild.get(this.alphaId) ?? null : null
  }

  wildActor(entityId: string): Actor | undefined {
    return this.wild.get(entityId)
  }

  allyActor(combatantId: string): Actor | undefined {
    return this.allies.get(combatantId)
  }

  get allyActors(): readonly Actor[] {
    return [...this.allies.values()]
  }

  /**
   * Puts our side on the floor next to the foe and locks the trainer in place.
   * The foe is the actor that was already there; nothing new is created for it.
   */
  openCombat(
    tiles: FloorTiles,
    foeEntityId: string,
    allies: readonly { combatantId: string; speciesId: number }[],
  ): { readonly spots: readonly TilePoint[]; readonly foe: Actor | null } {
    const foe = this.wild.get(foeEntityId) ?? null
    const foeAt = foe ? { x: foe.tx, y: foe.ty } : { x: this.player.tx, y: this.player.ty }
    const busy = [...this.wild.values()].filter(a => a !== foe).map(a => ({ x: a.tx, y: a.ty }))

    // D1.2.2 §14: the Boss Room has designed spots. The trainer takes theirs
    // just inside the door and each Pokémon the one in front of it, so the room
    // reads Alpha → our side → us without anything having to be computed.
    if (isBossFloor(tiles) && foe === this.alphaActor && foe) {
      const slots = tiles.boss
      this.place(slots.trainers[0])
      this.locked = true
      this.bossFraming = true
      this.player.dir = 'up'
      foe.dir = 'down'
      this.spawnAllies(allies, slots.allies.slice(0, allies.length), foeAt)
      return { spots: slots.allies.slice(0, allies.length), foe }
    }

    // D1.2.3 §2: the trainer takes one step back — straight back from whatever
    // they are facing, and to a side when that is blocked — and our Pokémon
    // takes the tile they were standing on. The fight reads foe → ours → us.
    const here = { x: this.player.tx, y: this.player.ty }
    const vacated = this.player.tx === foeAt.x && this.player.ty === foeAt.y ? null : here
    const stepped = this.stepBackFrom(tiles, foeAt, busy)
    if (!stepped && !vacated) {
      // Standing on the foe with nowhere to retreat: fall back to the old rule.
      const behind = { x: foeAt.x, y: foeAt.y + 2 }
      if (isWalkable(tiles, behind.x, behind.y)) this.place(behind)
    }

    const trainerAt = { x: this.player.tx, y: this.player.ty }
    const staged = stageCombat(tiles, foeAt, trainerAt, busy, allies.length)
    // The first Pokémon out stands where we were, facing the foe.
    const spots = stepped && vacated
      ? [vacated, ...staged.allies.filter(spot => spot.x !== vacated.x || spot.y !== vacated.y)]
      : staged.allies

    this.locked = true
    this.player.dir = facingBetween(trainerAt, foeAt)
    this.player.progress = 1
    if (foe) foe.dir = facingBetween(foeAt, spots[0] ?? trainerAt)

    this.spawnAllies(allies, spots, foeAt)
    return { spots, foe }
  }

  /**
   * One step directly away from `from`, or to a side when that is rock, or
   * nothing when the trainer is boxed in. Returns whether they moved.
   */
  private stepBackFrom(tiles: FloorTiles, from: TilePoint, busy: readonly TilePoint[]): boolean {
    const here = { x: this.player.tx, y: this.player.ty }
    const dx = Math.sign(here.x - from.x)
    const dy = Math.sign(here.y - from.y)
    const back = dx !== 0 || dy !== 0 ? { x: here.x + dx, y: here.y + dy } : null
    const sides = dx !== 0
      ? [{ x: here.x, y: here.y - 1 }, { x: here.x, y: here.y + 1 }]
      : [{ x: here.x - 1, y: here.y }, { x: here.x + 1, y: here.y }]
    const taken = new Set([...busy, from].map(spot => `${spot.x}:${spot.y}`))
    for (const spot of [back, ...sides]) {
      if (!spot || taken.has(`${spot.x}:${spot.y}`)) continue
      if (!isWalkable(tiles, spot.x, spot.y) || this.area.isSolid(spot.x, spot.y)) continue
      this.place(spot)
      return true
    }
    return false
  }

  /** Puts our Pokémon on the given tiles, facing the foe. */
  private spawnAllies(
    allies: readonly { combatantId: string; speciesId: number }[],
    spots: readonly TilePoint[],
    foeAt: TilePoint,
  ): void {
    preloadSpecies(allies.map(ally => ally.speciesId))
    allies.forEach((ally, index) => {
      const spot = spots[index] ?? spots[spots.length - 1]
      const species = speciesById(ally.speciesId)
      this.allies.set(ally.combatantId, createActor({
        id: `ally-${ally.combatantId}`,
        kind: 'pokemon',
        habitat: 'land',
        tx: spot.x,
        ty: spot.y,
        dir: facingBetween(spot, foeAt),
        pokemon: { id: ally.speciesId, name: species?.name ?? 'Pokémon', shiny: false, frames: speciesFrames(ally.speciesId) },
      }))
    })
  }

  /** Replaces one ally sprite in place (a switch), keeping its tile. */
  swapAlly(combatantId: string, speciesId: number): void {
    const actor = this.allies.get(combatantId)
    if (!actor) return
    const species = speciesById(speciesId)
    actor.pokemon = { id: speciesId, name: species?.name ?? 'Pokémon', shiny: false, frames: speciesFrames(speciesId) }
  }

  /** Ends the fight: our Pokémon go back to their Balls, the trainer walks again. */
  closeCombat(clearedEntityId: string | null): void {
    this.allies.clear()
    if (clearedEntityId) this.wild.delete(clearedEntityId)
    this.locked = false
    this.bossFraming = false
  }

  /** Every actor the scene should draw, the player excluded (the scene adds it). */
  actors(): Actor[] {
    const alpha = this.alphaActor
    return [...this.wild.values(), ...this.allies.values()].filter(actor => actor !== alpha)
  }

  rules(tiles: FloorTiles): MoveRules {
    const occupied = () => [...this.wild.values(), ...this.allies.values()]
    return {
      blocked: (_actor, tx, ty) => !isWalkable(tiles, tx, ty) || this.area.isSolid(tx, ty)
        || this.sealed.has(`${tx}:${ty}`),
      occupied: (tx, ty, self) => occupied().some(other => other !== self && other.tx === tx && other.ty === ty),
    }
  }

  /**
   * One frame, run exactly the way `engine/game.ts` runs the overworld (§3, §4):
   * the speed is latched per tile, `driveWalker` does the walking, and the
   * camera is **locked** to the player's whole-pixel position — easing only
   * kicks in after a jump of more than three tiles, so the view never drifts
   * behind a step.
   */
  update(dt: number, tiles: FloorTiles, want: Dir | null, onArrive?: (tx: number, ty: number) => void, sprinting = false): void {
    const rules = this.rules(tiles)
    const player = this.player
    if (this.locked) {
      // A fight owns the trainer: no walking, and any tap route is dropped.
      this.nav.cancel()
      player.progress = 1
      player.bumping = false
    } else {
      // Exactly the overworld's order: a key always wins over a tap route.
      if (want) this.nav.cancel()
      const navigating = !want && this.nav.active
      player.running = sprinting
      if (!isMoving(player)) {
        player.speed = (sprinting ? RUN_SPEED : WALK_SPEED) * (this.area.isWater(player.tx, player.ty) ? 0.7 : 1)
      }
      driveWalker(player, navigating ? this.nav.next : want, dt, rules, this.walker, (tx, ty) => {
        if (navigating) this.nav.arrived()
        onArrive?.(tx, ty)
      }, navigating)
      this.arrivedAtTarget = this.nav.update(player, dt)
    }
    for (const actor of this.actors()) advance(actor, dt)

    const target = this.cameraTarget()
    const gap = Math.hypot(target.x - this.camX, target.y - this.camY)
    if (gap > TILE * 3) {
      const follow = 1 - Math.exp(-dt * 10)
      this.camX += (target.x - this.camX) * follow
      this.camY += (target.y - this.camY) * follow
    } else {
      this.camX = target.x
      this.camY = target.y
    }
  }

  /**
   * Where the camera looks. The overworld answer — the player — except in the
   * staged Alpha fight, where it is the point between the trainer and the Alpha
   * so both ends of the arena are on screen at once (§3).
   */
  cameraTarget(): { x: number; y: number } {
    const home = actorPosition(this.player)
    const alpha = this.bossFraming ? this.alphaActor : null
    if (!alpha) return home
    const boss = actorPosition(alpha)
    return { x: (home.x + boss.x) / 2, y: (home.y + boss.y) / 2 }
  }
}
