// Local player blocks (PERF-1 NPC experiment). Observes only.
//
// Every time the local player starts pushing against a tile, records what was
// there: a townsperson or wild actor of this client's own population, or
// terrain/props. Timestamps are wall-clock (Date.now) so one client's blocks
// can be lined up with what another client saw of it.

import { DIRS, type Actor } from '../engine/actors'

export interface BlockEvent {
  at: number
  cause: 'npc' | 'pokemon' | 'terrain'
  /** Population id of the actor in the way (client-local), when it was one. */
  actorId: string | null
  tx: number
  ty: number
}

export interface CollisionReport {
  npcBlocks: number
  pokemonBlocks: number
  terrainBlocks: number
  events: BlockEvent[]
}

const MAX_EVENTS = 500

export class CollisionTrace {
  private wasBumping = false
  private r: CollisionReport = { npcBlocks: 0, pokemonBlocks: 0, terrainBlocks: 0, events: [] }

  constructor(private readonly clock: () => number = () => Date.now()) {}

  clear(): void {
    this.wasBumping = false
    this.r = { npcBlocks: 0, pokemonBlocks: 0, terrainBlocks: 0, events: [] }
  }

  /** `population`: this client's own NPC and wild actors (the ones the walker collides with). */
  frame(player: Actor, population: readonly Actor[]): void {
    const bumping = player.bumping && player.progress >= 1
    if (bumping && !this.wasBumping) {
      const [dx, dy] = DIRS[player.dir]
      const tx = player.tx + dx
      const ty = player.ty + dy
      const other = population.find(actor => actor.tx === tx && actor.ty === ty)
      const cause = other ? (other.kind === 'pokemon' ? 'pokemon' : 'npc') : 'terrain'
      if (cause === 'npc') this.r.npcBlocks++
      else if (cause === 'pokemon') this.r.pokemonBlocks++
      else this.r.terrainBlocks++
      if (this.r.events.length < MAX_EVENTS) this.r.events.push({ at: this.clock(), cause, actorId: other?.id ?? null, tx, ty })
    }
    this.wasBumping = bumping
  }

  report(): CollisionReport {
    return { ...this.r, events: [...this.r.events] }
  }
}
