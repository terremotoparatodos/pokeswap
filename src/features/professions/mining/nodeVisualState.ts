// What a mining node looks like in the world, without opening any UI.
//
// Node gameplay status (R31-B) plus proximity and targeting become an art
// state, a proximity bubble, a ground ring and a glint. RESPAWNING and
// DEPLETED are separate visuals even though R31-A only has personal charges
// with a respawn timer (see R31B_FINDINGS B-04).

import type { NodeStatus } from '../ui/nodeStatus'
import type { BubbleKind } from '../art/miningFx'
import type { NodeArtState } from '../art/miningNodes'

export type NodeVisual =
  | 'available' | 'interactable' | 'targeted' | 'in_progress'
  | 'depleted' | 'respawning' | 'locked_level' | 'special_access' | 'rare'

export interface NodeVisualInput {
  readonly status: NodeStatus
  /** Player stands beside the node. */
  readonly adjacent: boolean
  /** The node's panel is open. */
  readonly targeted: boolean
  readonly mining: boolean
  readonly respawnInSeconds: number
  readonly respawnSeconds: number
  /** Rare mineral nodes (gold, crystal) glint when detected. */
  readonly rareNode: boolean
  /** Inside the Pokémon's prospecting radius. */
  readonly detected: boolean
}

export interface NodeVisualView {
  readonly visual: NodeVisual
  readonly art: NodeArtState
  /** 0..1 regrowth while respawning. */
  readonly respawnProgress: number
  readonly bubble: BubbleKind | null
  readonly ring: 'none' | 'soft' | 'strong'
  readonly glint: boolean
}

const BLOCKING_WITHOUT_ART: readonly NodeStatus[] = ['no_energy', 'no_tool', 'tool_tier', 'tool_broken', 'inventory_full']

export function nodeVisual(input: NodeVisualInput): NodeVisualView {
  const base = { respawnProgress: 0, bubble: null, ring: 'none', glint: false } as const

  if (input.mining) return { ...base, visual: 'in_progress', art: 'ready', ring: 'strong' }

  if (input.status === 'depleted') {
    if (input.respawnInSeconds > 0 && input.respawnSeconds > 0) {
      const progress = Math.max(0, Math.min(1, 1 - input.respawnInSeconds / input.respawnSeconds))
      return { ...base, visual: 'respawning', art: 'respawning', respawnProgress: progress, ring: input.targeted ? 'soft' : 'none' }
    }
    return { ...base, visual: 'depleted', art: 'depleted', ring: input.targeted ? 'soft' : 'none' }
  }

  if (input.status === 'locked_level') {
    return { ...base, visual: 'locked_level', art: 'ready', bubble: input.adjacent || input.targeted ? 'lock' : null }
  }
  if (input.status === 'locked_access') {
    return { ...base, visual: 'special_access', art: 'ready', bubble: input.adjacent || input.targeted ? 'seal' : null, glint: input.detected && input.rareNode }
  }

  const glint = input.rareNode && input.detected
  if (input.targeted) return { ...base, visual: 'targeted', art: 'ready', ring: 'strong', glint }
  if (input.adjacent) {
    // Other blockers (energy, tool, space) are explained in the panel; the world still says "minable".
    return { ...base, visual: 'interactable', art: 'ready', ring: 'soft', bubble: BLOCKING_WITHOUT_ART.includes(input.status) || input.status === 'available' ? 'pick' : null, glint }
  }
  return { ...base, visual: glint ? 'rare' : 'available', art: 'ready', glint }
}

/** Respawn frame index for the art (0..frames-1). */
export function respawnFrame(progress: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, Math.floor(progress * frames)))
}
