// Town populace — WildLands prototype
//
// The people and Pokémon of a town: standing residents with lines, wandering
// NPCs and, since R26, the real owned Pokémon strolling its plazas
// (engine/plazaPokemon.ts). Nothing here is persisted. Since WORLD-1D the
// wanderers and the plaza Pokémon follow shared patrols once the server clock
// is known, so every player sees them in the same place.

import { createActor, type Actor } from '../engine/actors'
import type { Populace, PopulaceContext, SharedPopulace } from '../engine/area'
import { buildPatrol } from '../../../../services/realtime/src/world/patrol.js'
import { NPC_SPEED } from '../../../../services/realtime/src/world/wildPopulation.js'
import type { Dir } from '../engine/characters'
import { PlazaPokemon, plazaCandidates, type PlazaResident } from '../engine/plazaPokemon'
import { pokeballInfo } from '../engine/pokeball'
import { loadPokemonInfo } from '../engine/population'
import type { TownArea } from './townArea'

const TOWN_DIRS: Dir[] = ['down', 'left', 'right', 'up']

export class TownPopulace implements Populace {
  readonly actors: Actor[] = []
  private readonly plaza: PlazaPokemon
  private shared: SharedPopulace | null = null
  private patrolled = false

  constructor(town: TownArea, context: PopulaceContext) {
    const { def } = town
    const looks = context.npcSprites
    def.residents.forEach((r, i) => {
      const { tx, ty } = town.nearestOpen(r)
      this.actors.push(createActor({
        id: `town:r${i}`, kind: 'npc', habitat: 'land', tx, ty, speed: 3, dir: r.dir,
        trainer: looks[(i + 2) % looks.length], stationary: true, lines: r.lines,
      }))
    })
    def.wanderers.forEach((spot, i) => {
      const { tx, ty } = town.nearestOpen(spot)
      this.actors.push(createActor({
        id: `town:n${i}`, kind: 'npc', habitat: 'land', tx, ty, speed: 3,
        dir: TOWN_DIRS[i % TOWN_DIRS.length], trainer: looks[i % looks.length],
      }))
    })
    // Homes keep off the tiles townsfolk start on.
    const candidates = plazaCandidates(town, def.plazaZones ?? [], this.actors.map(a => ({ tx: a.tx, ty: a.ty })))
    this.plaza = new PlazaPokemon(this.actors, candidates, context.pokedex, entry => loadPokemonInfo(entry, false), pokeballInfo)
  }

  setOwned(list: readonly PlazaResident[]): void {
    this.plaza.sync(list)
  }

  share(shared: SharedPopulace): void {
    this.shared = shared
  }

  update(): void {
    const shared = this.shared
    if (this.patrolled || !shared || shared.serverNow() === null) return
    this.patrolled = true
    const patrol = (actor: Actor) => {
      if (actor.stationary || actor.patrol) return
      actor.patrol = buildPatrol({
        key: actor.id, home: { tx: actor.homeTx, ty: actor.homeTy },
        walkable: (tx, ty) => shared.walkable(actor.habitat, tx, ty), speed: actor.kind === 'npc' ? NPC_SPEED : actor.speed,
      })
    }
    for (const actor of this.actors) patrol(actor)
    this.plaza.patrol = patrol
  }
}
