// ECO-GAMEPLAY-1 (experimental): the server's ECO population on screen.
//
// `EcoActors` draws exactly the server's list, by encounter id (opaque: not a Pokémon id, not an
// owner): new ids appear, missing ids go, the rest stay the same actors. It is shared by the open
// world's `Population` and by `EcoPopulace`, the populace of an area that has no other wanderers
// (a cave interior): ECO encounters only — no procedural trainers, never the hourly roster.

import { createActor, type Actor } from './actors'
import type { Populace, SharedPopulace } from './area'
import { loadWorkerPokemonInfo, type PokedexEntry } from './population'
import { buildPatrol } from '../../../../services/realtime/src/world/patrol.js'
import { WILD_SPEED } from '../../../../services/realtime/src/world/wildPopulation.js'
import type { EcoArea, EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'

export class EcoActors {
  private area: EcoArea | null = null
  private readonly byId = new Map<string, Actor | null>()

  /** `actors`: the populace's own list, where ECO actors are added and removed. */
  constructor(private readonly pokedex: readonly PokedexEntry[], private readonly actors: Actor[]) {}

  /** True for an id this populace holds as an ECO encounter (drawn or loading). */
  has(id: string): boolean {
    return this.byId.has(id)
  }

  /** Follows the server's list. `area` null: no ECO population here (outside the experiment). */
  sync(area: EcoArea | null, shared: SharedPopulace | null): void {
    if (area === this.area) return
    this.area = area
    const alive = new Set(area?.encounters.map(encounter => encounter.id) ?? [])
    for (const [id, actor] of this.byId) {
      if (alive.has(id)) continue
      this.byId.delete(id)
      const index = actor ? this.actors.indexOf(actor) : -1
      if (index >= 0) this.actors.splice(index, 1)
    }
    if (!shared) return
    for (const encounter of area?.encounters ?? []) if (!this.byId.has(encounter.id)) this.spawn(encounter, shared)
  }

  private spawn(encounter: EcoEncounter, shared: SharedPopulace): void {
    this.byId.set(encounter.id, null)
    // The species' look: the Pokédex entry when it has one, otherwise the overworld sheet by id.
    void loadWorkerPokemonInfo(this.pokedex, encounter.speciesId).then(info => {
      if (!info || this.byId.get(encounter.id) !== null) return // retired (or replaced) while loading
      const actor = createActor({ id: encounter.id, kind: 'pokemon', habitat: 'land', tx: encounter.tx, ty: encounter.ty, speed: WILD_SPEED, pokemon: info, wild: true })
      // The shared patrol around the server's tile: sampled at server time, the same on every client.
      actor.patrol = buildPatrol({ key: encounter.id, home: encounter, walkable: (tx, ty) => shared.walkable('land', tx, ty), speed: WILD_SPEED })
      this.byId.set(encounter.id, actor)
      this.actors.push(actor)
    })
  }
}

/** The populace of an area whose only wanderers are the server's ECO encounters (a cave interior). */
export class EcoPopulace implements Populace {
  readonly actors: Actor[] = []
  private shared: SharedPopulace | null = null
  private readonly eco: EcoActors

  constructor(pokedex: readonly PokedexEntry[]) {
    this.eco = new EcoActors(pokedex, this.actors)
  }

  share(shared: SharedPopulace): void {
    this.shared = shared
  }

  update(): void {
    const shared = this.shared
    const synced = (shared?.serverNow() ?? null) !== null
    this.eco.sync(synced ? shared!.ecoArea?.() ?? null : null, shared)
  }
}
