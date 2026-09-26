// Wild population — WildLands prototype
//
// Wild Pokémon are the realtime service's (WORLD-1D): one entity per
// Pokémon, one home, the same for everyone, drawn near the player. Without a
// server roster there are none — never a population rolled in this browser.
// Chunks near the player are populated with wandering NPC trainers, whose
// identity is deterministic and whose walk is a shared patrol once the server
// clock is known.

import { createActor, type Actor, type PokemonInfo } from './actors'
import { loadFrontFrames, loadOverworldFrames, type TrainerSprites } from './characters'
import { CHUNK_TILES } from './chunks'
import { hash2 } from './noise'
import type { Biome, World } from './world'
import type { SharedPopulace } from './area'
import { buildPatrol } from '../../../../services/realtime/src/world/patrol.js'
import { NPC_SPEED, WILD_SPEED } from '../../../../services/realtime/src/world/wildPopulation.js'
import type { WildEntity, WildRoster } from '../../../../services/realtime/src/world/worldProtocol.js'

/** Shared wild Pokémon are materialised within this many tiles of the player, released past the next. */
const SHARED_WILD_NEAR = 64
const SHARED_WILD_FAR = 96
import { BIOME_TYPES, normaliseType } from '../../../../services/realtime/src/world/wildPopulation.js'

export interface PokedexEntry {
  id: number
  name_es: string
  type1: string
  type2: string | null
  sprite_url: string | null
}

export { normaliseType }

/** Cosmetic shiny rate for wild spawns, same as the classic 1/64 of later games' charms. */
export const SHINY_ODDS = 1 / 64

export { BIOME_TYPES }

/** Pokédex entries matching any of the biome's types. */
export function candidatesFor(biome: Biome, pokedex: readonly PokedexEntry[]): PokedexEntry[] {
  const types: readonly string[] = BIOME_TYPES[biome]
  return pokedex.filter(p => types.includes(normaliseType(p.type1)!) || types.includes(normaliseType(p.type2) ?? ''))
}

export class Population {
  private readonly active = new Set<string>()
  private wildPokemonIds: readonly number[] = []
  readonly actors: Actor[] = []
  private shared: SharedPopulace | null = null
  /** The roster currently on screen; null in legacy mode. */
  private roster: WildRoster | null = null
  private readonly sharedWild = new Map<string, Actor | null>()
  private patrolled = false

  constructor(
    private readonly world: World,
    private readonly pokedex: readonly PokedexEntry[],
    private readonly npcSprites: readonly TrainerSprites[],
  ) {}

  share(shared: SharedPopulace): void {
    this.shared = shared
  }

  setWildPokemonIds(ids: readonly number[]): void {
    this.wildPokemonIds = ids
    const allowed = new Set(ids)
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i]
      if (actor.wild && actor.pokemon && !allowed.has(actor.pokemon.id)) {
        this.sharedWild.delete(actor.id)
        this.actors.splice(i, 1)
      }
    }
  }

  /** Populates chunks within one chunk of the player and releases distant ones. */
  update(playerTx: number, playerTy: number): void {
    const synced = (this.shared?.serverNow() ?? null) !== null
    const roster = synced ? this.shared!.wildRoster() : null
    if (roster !== this.roster) this.switchRoster(roster)
    if (synced && !this.patrolled) {
      this.patrolled = true
      for (const actor of this.actors) if (actor.kind === 'npc') this.patrolNpc(actor)
    }
    if (this.roster) this.updateSharedWild(playerTx, playerTy)
    const pcx = Math.floor(playerTx / CHUNK_TILES)
    const pcy = Math.floor(playerTy / CHUNK_TILES)
    for (let cy = pcy - 1; cy <= pcy + 1; cy++) {
      for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
        const key = `${cx},${cy}`
        if (!this.active.has(key)) {
          this.active.add(key)
          this.populate(cx, cy, key)
        }
      }
    }
    for (const key of this.active) {
      const [cx, cy] = key.split(',').map(Number)
      if (Math.abs(cx - pcx) > 2 || Math.abs(cy - pcy) > 2) this.release(key)
    }
  }

  private release(key: string): void {
    this.active.delete(key)
    for (let i = this.actors.length - 1; i >= 0; i--) {
      if (this.actors[i].id.startsWith(`${key}:`)) {
        this.actors.splice(i, 1)
      }
    }
  }

  /** A new hour, or no roster at all: every wild actor goes. */
  private switchRoster(roster: WildRoster | null): void {
    this.roster = roster
    for (let i = this.actors.length - 1; i >= 0; i--) if (this.actors[i].wild) this.actors.splice(i, 1)
    this.sharedWild.clear()
  }

  private updateSharedWild(playerTx: number, playerTy: number): void {
    const allowed = new Set(this.wildPokemonIds)
    for (const entity of this.roster!.entities) {
      const distance = Math.max(Math.abs(entity.tx - playerTx), Math.abs(entity.ty - playerTy))
      const held = this.sharedWild.has(entity.id)
      if (!held && distance <= SHARED_WILD_NEAR && allowed.has(entity.pokemonId)) this.spawnShared(entity)
      else if (held && distance > SHARED_WILD_FAR) {
        const actor = this.sharedWild.get(entity.id)
        this.sharedWild.delete(entity.id)
        const index = actor ? this.actors.indexOf(actor) : -1
        if (index >= 0) this.actors.splice(index, 1)
      }
    }
  }

  private spawnShared(entity: WildEntity): void {
    const entry = this.pokedex.find(pokemon => pokemon.id === entity.pokemonId)
    if (!entry || !this.shared) return
    const roster = this.roster
    const shared = this.shared
    this.sharedWild.set(entity.id, null)
    void this.spriteFor(entry, entity.shiny).then(info => {
      if (!info || this.roster !== roster || this.sharedWild.get(entity.id) !== null) return
      const actor = createActor({
        id: entity.id, kind: 'pokemon', habitat: entity.habitat, tx: entity.tx, ty: entity.ty, speed: WILD_SPEED, pokemon: info, wild: true,
      })
      actor.patrol = buildPatrol({ key: entity.id, home: entity, walkable: (tx, ty) => shared.walkable(entity.habitat, tx, ty), speed: WILD_SPEED })
      this.sharedWild.set(entity.id, actor)
      this.actors.push(actor)
    })
  }

  private patrolNpc(actor: Actor): void {
    const shared = this.shared
    if (!shared || actor.patrol) return
    actor.patrol = buildPatrol({ key: actor.id, home: { tx: actor.homeTx, ty: actor.homeTy }, walkable: (tx, ty) => shared.walkable('land', tx, ty), speed: NPC_SPEED })
  }

  private populate(cx: number, cy: number, key: string): void {
    const seed = this.world.seed
    const npcCount = Math.floor(hash2(cx, cy, seed + 950) * 3)
    for (let i = 0; i < npcCount; i++) {
      const tx = cx * CHUNK_TILES + Math.floor(hash2(cx * 17 + i, cy, seed + 951) * CHUNK_TILES)
      const ty = cy * CHUNK_TILES + Math.floor(hash2(cx, cy * 17 + i, seed + 952) * CHUNK_TILES)
      if (this.world.isSolid(tx, ty) || this.world.isWater(tx, ty)) continue
      const look = this.npcSprites[Math.floor(hash2(tx, ty, seed + 953) * this.npcSprites.length)]
      const npc = createActor({ id: `${key}:n${i}`, kind: 'npc', habitat: 'land', tx, ty, speed: 3.2, trainer: look })
      if (this.patrolled) this.patrolNpc(npc)
      this.actors.push(npc)
    }
  }

  private spriteFor(entry: PokedexEntry, shiny: boolean): Promise<PokemonInfo | null> {
    return loadPokemonInfo(entry, shiny)
  }
}

const pokemonInfoCache = new Map<string, Promise<PokemonInfo | null>>()

/** Overworld sheet first; the database front sprite if the species has no sheet. Cached per session. */
export function loadPokemonInfo(entry: Pick<PokedexEntry, 'id' | 'name_es' | 'sprite_url'>, shiny: boolean): Promise<PokemonInfo | null> {
  const key = `${entry.id}:${shiny}`
  let pending = pokemonInfoCache.get(key)
  if (!pending) {
    pending = loadOverworldFrames(entry.id, shiny)
      .then(frames => ({ id: entry.id, name: entry.name_es, shiny, frames }))
      .catch(() => {
        if (!entry.sprite_url) return null
        return loadFrontFrames(entry.sprite_url)
          .then(frames => ({ id: entry.id, name: entry.name_es, shiny: false, frames }))
          .catch(() => null)
      })
    pokemonInfoCache.set(key, pending)
  }
  return pending
}

/**
 * Info for a species the Pokédex has not delivered yet: the bundled overworld
 * sheet by id, with a placeholder name. Never cached, so it cannot stand in
 * for the real entry in `loadPokemonInfo`'s shared cache.
 */
export function loadProvisionalPokemonInfo(id: number): Promise<PokemonInfo | null> {
  return loadOverworldFrames(id, false)
    .then(frames => ({ id, name: String(id), shiny: false, frames }))
    .catch(() => null)
}

/** A worker's info (WORLD VISUAL-1): the real entry when the Pokédex has it, otherwise the uncached provisional one. */
export function loadWorkerPokemonInfo(pokedex: readonly Pick<PokedexEntry, 'id' | 'name_es' | 'sprite_url'>[], id: number): Promise<PokemonInfo | null> {
  const entry = pokedex.find(pokemon => pokemon.id === id)
  return entry ? loadPokemonInfo(entry, false) : loadProvisionalPokemonInfo(id)
}
