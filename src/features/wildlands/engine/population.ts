// Wild population — WildLands prototype
//
// Chunks near the player are populated with wild Pokémon (picked by biome
// type affinity from the real Pokédex rows) and wandering NPC trainers.
// Spawns are cosmetic: they exist only in this browser session.

import { createActor, type Actor, type PokemonInfo } from './actors'
import { loadFrontFrames, loadOverworldFrames, type TrainerSprites } from './characters'
import { CHUNK_TILES } from './chunks'
import { hash2 } from './noise'
import type { Biome, World } from './world'

export interface PokedexEntry {
  id: number
  name_es: string
  type1: string
  type2: string | null
  sprite_url: string | null
}

const TYPE_ALIASES: Record<string, string> = {
  planta: 'grass', fuego: 'fire', agua: 'water', normal: 'normal', bicho: 'bug', veneno: 'poison',
  'eléctrico': 'electric', electrico: 'electric', 'psíquico': 'psychic', psiquico: 'psychic', roca: 'rock',
  siniestro: 'dark', fantasma: 'ghost', tierra: 'ground', acero: 'steel', hielo: 'ice', lucha: 'fighting',
  'dragón': 'dragon', dragon: 'dragon', hada: 'fairy', volador: 'flying',
}

export function normaliseType(type: string | null): string | null {
  if (!type) return null
  const key = type.trim().toLowerCase()
  return TYPE_ALIASES[key] ?? key
}

/** Cosmetic shiny rate for wild spawns, same as the classic 1/64 of later games' charms. */
export const SHINY_ODDS = 1 / 64

export const BIOME_TYPES: Record<Biome, string[]> = {
  desert: ['ground', 'rock', 'fire', 'steel'],
  beach: ['water', 'normal', 'flying'],
  grassland: ['normal', 'grass', 'bug', 'electric', 'fairy'],
  forest: ['bug', 'grass', 'poison', 'ghost', 'dark'],
  tundra: ['ice', 'steel', 'psychic'],
  ocean: ['water', 'dragon'],
  deep: ['water', 'dragon'],
}

/** Pokédex entries matching any of the biome's types. */
export function candidatesFor(biome: Biome, pokedex: readonly PokedexEntry[]): PokedexEntry[] {
  const types = BIOME_TYPES[biome]
  return pokedex.filter(p => types.includes(normaliseType(p.type1)!) || types.includes(normaliseType(p.type2) ?? ''))
}

export class Population {
  private readonly active = new Set<string>()
  readonly actors: Actor[] = []

  constructor(
    private readonly world: World,
    private readonly pokedex: readonly PokedexEntry[],
    private readonly npcSprites: readonly TrainerSprites[],
  ) {}

  /** Populates chunks within one chunk of the player and releases distant ones. */
  update(playerTx: number, playerTy: number): void {
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
      if (this.actors[i].id.startsWith(`${key}:`)) this.actors.splice(i, 1)
    }
  }

  private populate(cx: number, cy: number, key: string): void {
    const seed = this.world.seed
    const pokemonCount = 4 + Math.floor(hash2(cx, cy, seed + 900) * 4)
    for (let i = 0; i < pokemonCount; i++) {
      const tx = cx * CHUNK_TILES + Math.floor(hash2(cx * 31 + i, cy, seed + 901) * CHUNK_TILES)
      const ty = cy * CHUNK_TILES + Math.floor(hash2(cx, cy * 31 + i, seed + 902) * CHUNK_TILES)
      if (this.world.isSolid(tx, ty)) continue
      const biome = this.world.biomeAt(tx + 0.5, ty + 0.5)
      const water = this.world.isWater(tx, ty)
      const pool = candidatesFor(water ? 'ocean' : biome, this.pokedex)
      if (!pool.length) continue
      const entry = pool[Math.floor(hash2(tx, ty, seed + 903) * pool.length)]
      const shiny = hash2(tx, ty, seed + 904) < SHINY_ODDS
      void this.spriteFor(entry, shiny).then(info => {
        if (!info || !this.active.has(key)) return
        this.actors.push(createActor({
          id: `${key}:p${i}`, kind: 'pokemon', habitat: water ? 'water' : 'land', tx, ty,
          speed: 3, pokemon: info, dir: hash2(tx, ty, 3) < 0.5 ? 'left' : 'right',
        }))
      })
    }

    const npcCount = Math.floor(hash2(cx, cy, seed + 950) * 3)
    for (let i = 0; i < npcCount; i++) {
      const tx = cx * CHUNK_TILES + Math.floor(hash2(cx * 17 + i, cy, seed + 951) * CHUNK_TILES)
      const ty = cy * CHUNK_TILES + Math.floor(hash2(cx, cy * 17 + i, seed + 952) * CHUNK_TILES)
      if (this.world.isSolid(tx, ty) || this.world.isWater(tx, ty)) continue
      const look = this.npcSprites[Math.floor(hash2(tx, ty, seed + 953) * this.npcSprites.length)]
      this.actors.push(createActor({ id: `${key}:n${i}`, kind: 'npc', habitat: 'land', tx, ty, speed: 3.2, trainer: look }))
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
