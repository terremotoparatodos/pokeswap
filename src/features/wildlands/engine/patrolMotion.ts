// Shared wandering on screen (WORLD-1D).
//
// An actor with a patrol is not simulated here: its pose is read from the
// shared loop at the server's time, every frame, so every client draws it on
// the same tile at the same moment. Nothing accumulates, so a hidden tab or a
// dropped frame never makes it drift.

import type { Actor } from './actors'
import { samplePatrol } from '../../../../services/realtime/src/world/patrol.js'

export function followPatrol(actor: Actor, serverNow: number): void {
  const patrol = actor.patrol
  if (!patrol) return
  const pose = samplePatrol(patrol, serverNow)
  actor.fromTx = pose.fromTx
  actor.fromTy = pose.fromTy
  actor.tx = pose.tx
  actor.ty = pose.ty
  actor.progress = pose.progress
  actor.dir = pose.dir
  actor.speed = patrol.speed
  if (pose.progress < 1) {
    actor.walkClock = (serverNow / 1000) * patrol.speed
    if (actor.kind === 'pokemon') actor.hop = Math.sin(pose.progress * Math.PI) * 1.5
  } else {
    actor.hop = 0
  }
}

/**
 * One frame of a populace actor (NPC, wanderer, wild or plaza Pokémon).
 *
 * There is no local simulation any more: before the server clock is known the
 * actor stays frozen on its deterministic starting tile (the same tile on every
 * client), and once the clock is known it follows its shared patrol. A player
 * never sees a wanderer somewhere another player does not.
 */
export function driveWanderer(actor: Actor, serverNow: number | null): void {
  if (serverNow !== null && actor.patrol) followPatrol(actor, serverNow)
}
