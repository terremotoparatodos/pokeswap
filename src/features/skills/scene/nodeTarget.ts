// What the scene needs to know about one resource node to draw it.
//
// The node's *state* comes from whoever owns nodes (the pre-WORLD local
// stand-in today, WORLD-1 tomorrow); whether the player may work it comes
// from Skills. The scene only draws.

import type { Biome } from '../../wildlands/engine/world'
import type { ResourceDefinition } from '../domain/resources'

/** A node the player can walk up to. */
export interface NodeTarget {
  readonly nodeId: string
  readonly resource: ResourceDefinition
  readonly biome: Biome
}

/**
 * `locked_level` is the only rule-based state: aptitude depends on which
 * Pokémon the player picks, so it never locks a node in the world.
 */
export type NodeStatus = 'available' | 'locked_level' | 'depleted'

export interface NodeState {
  readonly status: NodeStatus
  readonly remainingCharges: number
  /** Seconds until a depleted node is back; 0 when not depleted. */
  readonly respawnInSeconds: number
}
