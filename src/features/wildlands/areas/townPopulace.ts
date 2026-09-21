// Town populace — WildLands prototype
//
// The people and Pokémon of a town: standing residents with lines, wandering
// NPCs and, since R26, the real owned Pokémon strolling its plazas
// (engine/plazaPokemon.ts). Everything is cosmetic and session-only.

import { createActor, type Actor } from '../engine/actors'
import type { Populace, PopulaceContext } from '../engine/area'
import type { Dir } from '../engine/characters'
import { PlazaPokemon, plazaCandidates, type PlazaResident } from '../engine/plazaPokemon'
import { pokeballInfo } from '../engine/pokeball'
import { loadPokemonInfo } from '../engine/population'
import type { TownArea } from './townArea'

const TOWN_DIRS: Dir[] = ['down', 'left', 'right', 'up']

export class TownPopulace implements Populace {
  readonly actors: Actor[] = []
  private readonly plaza: PlazaPokemon

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

  update(): void {}
}
