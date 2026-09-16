// What a fishing spot looks like in the world, without opening any UI.
// Mirrors the mining node visual state so both professions read the same way.

import type { BubbleKind } from '../art/miningFx'
import type { SpotArtState } from '../art/fishingSpots'
import type { NodeStatus } from '../ui/nodeStatus'

export type SpotVisual =
  | 'available' | 'interactable' | 'targeted' | 'waiting' | 'bite'
  | 'depleted' | 'respawning' | 'locked_level' | 'special_access' | 'rare'

export interface SpotVisualInput {
  readonly status: NodeStatus
  /** Player stands beside the spot. */
  readonly adjacent: boolean
  readonly targeted: boolean
  /** A cast is running on this spot. */
  readonly fishing: boolean
  /** The fish is hooked right now. */
  readonly biting: boolean
  readonly respawnInSeconds: number
  readonly respawnSeconds: number
  /** Reef and deep spots glint when the Pokémon's prospecting reaches them. */
  readonly rareSpot: boolean
  readonly detected: boolean
}

export interface SpotVisualView {
  readonly visual: SpotVisual
  readonly art: SpotArtState
  readonly respawnProgress: number
  readonly bubble: BubbleKind | null
  readonly ring: 'none' | 'soft' | 'strong'
  readonly glint: boolean
}

const BLOCKING_WITHOUT_ART: readonly NodeStatus[] = ['no_energy', 'no_tool', 'tool_tier', 'tool_broken', 'inventory_full']

export function spotVisual(input: SpotVisualInput): SpotVisualView {
  const base = { respawnProgress: 0, bubble: null, ring: 'none', glint: false } as const

  if (input.fishing) {
    return input.biting
      ? { ...base, visual: 'bite', art: 'bite', ring: 'strong' }
      : { ...base, visual: 'waiting', art: 'ready', ring: 'strong' }
  }

  if (input.status === 'depleted') {
    if (input.respawnInSeconds > 0 && input.respawnSeconds > 0) {
      const progress = Math.max(0, Math.min(1, 1 - input.respawnInSeconds / input.respawnSeconds))
      return { ...base, visual: 'respawning', art: 'respawning', respawnProgress: progress, ring: input.targeted ? 'soft' : 'none' }
    }
    return { ...base, visual: 'depleted', art: 'spent', ring: input.targeted ? 'soft' : 'none' }
  }

  if (input.status === 'locked_level') {
    return { ...base, visual: 'locked_level', art: 'ready', bubble: input.adjacent || input.targeted ? 'lock' : null }
  }
  if (input.status === 'locked_access') {
    return { ...base, visual: 'special_access', art: 'ready', bubble: input.adjacent || input.targeted ? 'seal' : null, glint: input.detected && input.rareSpot }
  }

  const glint = input.rareSpot && input.detected
  if (input.targeted) return { ...base, visual: 'targeted', art: 'ready', ring: 'strong', glint }
  if (input.adjacent) {
    return {
      ...base, visual: 'interactable', art: 'ready', ring: 'soft', glint,
      bubble: BLOCKING_WITHOUT_ART.includes(input.status) || input.status === 'available' ? 'rod' : null,
    }
  }
  return { ...base, visual: glint ? 'rare' : 'available', art: 'ready', glint }
}

/** Respawn frame index for the art (0..frames-1). */
export function spotRespawnFrame(progress: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, Math.floor(progress * frames)))
}
