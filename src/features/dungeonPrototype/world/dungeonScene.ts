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

import { actorPosition, createActor, driveWalker, createWalkerState, advance, type Actor, type MoveRules } from '../../wildlands/engine/actors'
import type { Lighting } from '../../wildlands/engine/atmosphere'
import type { Dir, TrainerSprites } from '../../wildlands/engine/characters'
import { TILE } from '../../wildlands/engine/world'
import { isWalkable, type FloorEntity, type FloorTiles, type TilePoint } from '../domain/floorTiles'
import { speciesById } from '../data/speciesFixtures'
import { speciesFrames, preloadSpecies } from '../render/dungeonSprites'
import { DungeonArea, DUNGEON_DARKNESS } from './dungeonArea'
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
  /** The Alpha is drawn at twice the size by the overlay, so it is not a plain actor. */
  private alphaId: string | null = null
  /** Set while a fight is on: the trainer keeps their tile and stops walking. */
  locked = false
  camX = 0
  camY = 0

  constructor(trainer: TrainerSprites, tiles: FloorTiles, entities: readonly FloorEntity[], at: TilePoint, seed: number, floor: number) {
    this.area = new DungeonArea(tiles, seed, floor)
    this.player = createActor({
      id: 'trainer', kind: 'player', habitat: 'land', tx: at.x, ty: at.y, trainer, dir: 'down',
    })
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

    // The Alpha stands on the stairs, which is exactly where the player arrives.
    // Step the trainer back so the room reads front to back: the Alpha, then our
    // Pokémon, then us. Placement only — the fight is still on the same tile.
    if (this.player.tx === foeAt.x && this.player.ty === foeAt.y) {
      const behind = { x: foeAt.x, y: foeAt.y + 2 }
      const spot = isWalkable(tiles, behind.x, behind.y)
        ? behind
        : openGround(tiles, foeAt, busy, { x: foeAt.x, y: foeAt.y + 3 })[0]
      if (spot) this.place(spot)
    }

    const staged = stageCombat(tiles, foeAt, { x: this.player.tx, y: this.player.ty }, busy, allies.length)

    this.locked = true
    this.player.dir = staged.trainerFacing
    this.player.progress = 1
    if (foe) foe.dir = staged.foeFacing

    preloadSpecies(allies.map(a => a.speciesId))
    allies.forEach((ally, index) => {
      const spot = staged.allies[index]
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
    return { spots: staged.allies, foe }
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
  }

  /** Every actor the scene should draw, the player excluded (the scene adds it). */
  actors(): Actor[] {
    const alpha = this.alphaActor
    return [...this.wild.values(), ...this.allies.values()].filter(actor => actor !== alpha)
  }

  rules(tiles: FloorTiles): MoveRules {
    const occupied = () => [...this.wild.values(), ...this.allies.values()]
    return {
      blocked: (_actor, tx, ty) => !isWalkable(tiles, tx, ty),
      occupied: (tx, ty, self) => occupied().some(other => other !== self && other.tx === tx && other.ty === ty),
    }
  }

  /**
   * One frame: the trainer walks (unless a fight has them), everyone advances,
   * and the camera eases toward the trainer.
   */
  update(dt: number, tiles: FloorTiles, want: Dir | null, onArrive?: (tx: number, ty: number) => void): void {
    const rules = this.rules(tiles)
    if (this.locked) {
      this.player.progress = 1
      this.player.bumping = false
    } else {
      driveWalker(this.player, want, dt, rules, this.walker, onArrive)
    }
    for (const actor of this.actors()) advance(actor, dt)

    const target = actorPosition(this.player)
    const ease = Math.min(1, dt * 9)
    this.camX += (target.x - this.camX) * ease
    this.camY += (target.y - this.camY) * ease
    // A floor change is a jump, not a walk: snap when we are far away.
    if (Math.hypot(target.x - this.camX, target.y - this.camY) > TILE * 6) {
      this.camX = target.x
      this.camY = target.y
    }
  }
}
