// Worker Pokémon beside the nodes they work (WORLD-1C, WORLD VISUAL-1).
//
// The one renderer of every worker, the local player's own included. Nothing
// about the worker travels per frame: the server says who works which node
// with which Pokémon, from when to when, and where it stands (`worker.stand`,
// fixed when the work started). Every client animates it from the shared
// clock, so two players see the same Pokémon on the same tile, leaning into
// the same tree in time.

import { createActor, type Actor, type PokemonInfo } from '../../wildlands/engine/actors'
import type { Dir } from '../../wildlands/engine/characters'
import type { Tile } from '../../wildlands/engine/pathfinding'
import type { NodeView } from '../domain/worldResources'
import { workerPose, type WorkerStandTile } from './workerPose'

export type LoadPokemon = (pokemonId: number) => Promise<PokemonInfo | null>
export type PlaceholderPokemon = (pokemonId: number) => PokemonInfo

const SIDES: readonly (readonly [number, number, Dir])[] = [[0, 1, 'up'], [1, 0, 'left'], [-1, 0, 'right'], [0, -1, 'down']]

/**
 * Fallback for a server that does not send `worker.stand`: an open orthogonal
 * neighbour of the node, nearest its trainer, recomputed every frame.
 */
export function workerSpot(node: Tile, trainer: Tile | null, isSolid: (tx: number, ty: number) => boolean): Tile & { dir: Dir } {
  const open = SIDES
    .map(([dx, dy, dir]) => ({ tx: node.tx + dx, ty: node.ty + dy, dir }))
    .filter(spot => !isSolid(spot.tx, spot.ty) && !(trainer && spot.tx === trainer.tx && spot.ty === trainer.ty))
  if (!open.length) return { tx: node.tx, ty: node.ty + 1, dir: 'up' }
  if (!trainer) return open[0]
  const distance = (spot: Tile) => Math.max(Math.abs(spot.tx - trainer.tx), Math.abs(spot.ty - trainer.ty))
  return open.reduce((best, spot) => (distance(spot) < distance(best) ? spot : best))
}

interface Worker {
  actor: Actor
  nodeTx: number
  nodeTy: number
  playerId: string
  pokemonId: number
  startedAt: number
  /** From the server; null only with an older server (see `workerSpot`). */
  stand: WorkerStandTile | null
}

export class WorkerActors {
  private readonly workers = new Map<string, Worker>()
  private readonly list: Actor[] = []

  constructor(private readonly load: LoadPokemon, private readonly placeholder: PlaceholderPokemon) {}

  /** Adds workers for new actions and drops those whose action ended. */
  sync(active: Iterable<NodeView>): void {
    const live = new Set<string>()
    for (const node of active) {
      if (!node.actionId || !node.worker) continue
      live.add(node.actionId)
      const known = this.workers.get(node.actionId)
      if (known) {
        known.stand ??= node.worker.stand ?? null
        continue
      }
      const [, tx, ty] = node.id.split(':').map(Number) as [number, number, number]
      const pokemonId = node.worker.speciesId
      const actor = createActor({ id: `world-worker:${node.actionId}`, kind: 'pokemon', habitat: 'any', tx, ty: ty + 1, remote: true, pokemon: this.placeholder(pokemonId) })
      const worker: Worker = {
        actor, nodeTx: tx, nodeTy: ty, playerId: node.worker.playerId, pokemonId: node.worker.pokemonInstanceId,
        startedAt: node.startedAt ?? 0, stand: node.worker.stand ?? null,
      }
      this.workers.set(node.actionId, worker)
      void this.load(pokemonId).then(info => { if (info && this.workers.get(node.actionId!) === worker) actor.pokemon = info }).catch(() => undefined)
    }
    for (const actionId of [...this.workers.keys()]) if (!live.has(actionId)) this.workers.delete(actionId)
    this.list.length = 0
    for (const worker of this.workers.values()) this.list.push(worker.actor)
  }

  /** Places and animates every worker at `serverNow`. The trainer and terrain only matter without a stand. */
  update(serverNow: number, trainerTile: (playerId: string) => Tile | null, isSolid: (tx: number, ty: number) => boolean): void {
    for (const worker of this.workers.values()) {
      const stand = worker.stand ?? workerSpot({ tx: worker.nodeTx, ty: worker.nodeTy }, trainerTile(worker.playerId), isSolid)
      Object.assign(worker.actor, workerPose(stand, worker.startedAt, serverNow))
    }
  }

  actors(): readonly Actor[] {
    return this.list
  }

  isWorking(ownerId: string, pokemonId: number): boolean {
    for (const worker of this.workers.values()) if (worker.playerId === ownerId && worker.pokemonId === pokemonId) return true
    return false
  }
}
