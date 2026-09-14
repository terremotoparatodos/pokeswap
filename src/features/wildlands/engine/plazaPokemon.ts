// Plaza Pokémon — WildLands lobby (R26)
//
// The owned Pokémon that stroll around the town plazas (the top 10 by price,
// decided outside the engine by map/domain/ownedSlots). `sync` receives the
// wanted list and adds or removes actors; each one gets a stable home tile
// inside the plaza zones, away from doors and gates. The engine only knows the
// Pokémon id and whether it belongs to the viewer: owners, usernames and prices
// never reach the canvas. Positions are cosmetic and never persisted.

import { diffIds } from '../../map/domain/ownedSlots'
import { createActor, type Actor, type PokemonInfo } from './actors'
import type { Portal } from './area'
import type { BuildingDoor } from './doors'
import type { Tile } from './pathfinding'
import type { PokedexEntry } from './population'
import type { TileRect } from './townGround'

export interface PlazaResident {
  pokemonId: number
  /** Owned by the signed-in viewer: drawn with a marker. */
  mine: boolean
}

/** Homes stay this many tiles (Chebyshev) from doors: wanderers stray up to 5 tiles from home. */
export const DOOR_CLEARANCE = 6
/** Homes stay this far from gate tiles, so arrivals are never crowded. */
export const PORTAL_CLEARANCE = 4
/** Minimum distance between two homes. */
export const HOME_SPACING = 3

export interface PlazaGround {
  isSolid(tx: number, ty: number): boolean
  readonly portals: readonly Portal[]
  readonly doors: readonly BuildingDoor[]
}

export type Home = Tile & { zone: number }

const distance = (a: Tile, b: Tile) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

/** Open tiles of each zone (row by row) that keep clear of doors, gates and `reserved` tiles. */
export function plazaCandidates(ground: PlazaGround, zones: readonly TileRect[], reserved: readonly Tile[]): Tile[][] {
  const gates = ground.portals.flatMap(p => p.tiles)
  return zones.map(zone => {
    const tiles: Tile[] = []
    for (let ty = zone.y0; ty <= zone.y1; ty++) {
      for (let tx = zone.x0; tx <= zone.x1; tx++) {
        const t = { tx, ty }
        if (ground.isSolid(tx, ty)) continue
        if (ground.doors.some(d => distance(d.door, t) < DOOR_CLEARANCE)) continue
        if (gates.some(g => distance(g, t) < PORTAL_CLEARANCE)) continue
        if (reserved.some(r => r.tx === tx && r.ty === ty)) continue
        tiles.push(t)
      }
    }
    return tiles
  })
}

/** Deterministic spread of small ids, so a Pokémon returns to the same spot every visit. */
function spread(id: number, salt: number): number {
  return Math.imul(id + salt * 0x9e37, 0x85ebca6b) >>> 13
}

/**
 * Home tile for `id`: the least crowded zone (ties go to the zone the id
 * prefers), then the first tile from its preferred offset that keeps
 * HOME_SPACING from every taken home. Null when the plazas are full.
 */
export function assignHome(id: number, candidates: readonly (readonly Tile[])[], taken: readonly Home[]): Home | null {
  const zones = candidates.map((_, i) => i).filter(i => candidates[i].length > 0)
  if (!zones.length) return null
  const preferred = spread(id, 1) % candidates.length
  const load = (z: number) => taken.filter(h => h.zone === z).length
  const offset = (z: number) => (z - preferred + candidates.length) % candidates.length
  zones.sort((a, b) => load(a) - load(b) || offset(a) - offset(b))
  for (const zone of zones) {
    const list = candidates[zone]
    const start = spread(id, 2) % list.length
    for (let k = 0; k < list.length; k++) {
      const t = list[(start + k) % list.length]
      if (taken.every(h => distance(h, t) >= HOME_SPACING)) return { ...t, zone }
    }
  }
  return null
}

export type LoadPokemonInfo = (entry: Pick<PokedexEntry, 'id' | 'name_es' | 'sprite_url'>) => Promise<PokemonInfo | null>

interface Member {
  home: Home
  mine: boolean
  actor: Actor | null
}

export class PlazaPokemon {
  private readonly members = new Map<number, Member>()

  /**
   * @param actors   The populace's actor list; plaza Pokémon are pushed into and spliced out of it.
   * @param fallback Art for species without an overworld sheet or database sprite.
   */
  constructor(
    private readonly actors: Actor[],
    private readonly candidates: readonly (readonly Tile[])[],
    private readonly pokedex: readonly PokedexEntry[],
    private readonly load: LoadPokemonInfo,
    private readonly fallback: (entry: Pick<PokedexEntry, 'id' | 'name_es'>) => PokemonInfo,
  ) {}

  /** Ids currently in the plaza (including ones whose art is still loading). */
  get ids(): number[] {
    return [...this.members.keys()]
  }

  sync(list: readonly PlazaResident[]): void {
    const wanted = new Map(list.map(r => [r.pokemonId, r]))
    const { entered, left, kept } = diffIds(new Set(this.members.keys()), new Set(wanted.keys()))

    for (const id of left) {
      const member = this.members.get(id)!
      this.members.delete(id)
      if (member.actor) {
        const index = this.actors.indexOf(member.actor)
        if (index >= 0) this.actors.splice(index, 1)
      }
    }

    for (const id of kept) {
      const member = this.members.get(id)!
      member.mine = wanted.get(id)!.mine
      if (member.actor) member.actor.owned = { mine: member.mine }
    }

    for (const id of entered.sort((a, b) => a - b)) {
      const home = assignHome(id, this.candidates, [...this.members.values()].map(m => m.home))
      if (!home) continue
      const member: Member = { home, mine: wanted.get(id)!.mine, actor: null }
      this.members.set(id, member)
      const entry = this.pokedex.find(p => p.id === id) ?? { id, name_es: `#${id}`, sprite_url: null }
      void this.load(entry)
        .catch(() => null)
        .then(info => {
          // Left (or left and came back) while the art was loading.
          if (this.members.get(id) !== member) return
          member.actor = createActor({
            id: `plaza:${id}`, kind: 'pokemon', habitat: 'land', tx: home.tx, ty: home.ty, speed: 2.5,
            pokemon: info ?? this.fallback(entry), owned: { mine: member.mine },
          })
          this.actors.push(member.actor)
        })
    }
  }
}
