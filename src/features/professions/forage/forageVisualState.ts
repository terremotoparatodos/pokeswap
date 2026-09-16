// What a forage node looks like in the world, without opening any UI.
//
// Same shape as the mining, fishing and logging visual states: node status plus
// proximity and targeting become an art state, a marker, a ground ring and a
// glint. A picked plant keeps its twigs and grows its fruit back through it.

import type { BubbleKind } from '../art/miningFx'
import { REGROW_FRAMES, type ForageArtState } from '../art/forageNodes'
import type { NodeStatus } from '../ui/nodeStatus'

export type ForageVisual =
  | 'available' | 'interactable' | 'targeted' | 'gathering'
  | 'picked' | 'regrowing' | 'locked_level' | 'special_access' | 'rare'

export interface ForageVisualInput {
  readonly status: NodeStatus
  /** Player stands beside the plant. */
  readonly adjacent: boolean
  readonly targeted: boolean
  readonly gathering: boolean
  readonly respawnInSeconds: number
  readonly respawnSeconds: number
  /** The grove and the frost bloom are worth spotting from afar. */
  readonly rareNode: boolean
  readonly detected: boolean
  /** Nodes that need a sickle show the sickle bubble; the rest show a hand. */
  readonly needsTool: boolean
}

export interface ForageVisualView {
  readonly visual: ForageVisual
  readonly art: ForageArtState
  /** Regrowth frame while the fruit comes back. */
  readonly frame: number
  /** 0..1 regrowth progress. */
  readonly regrowProgress: number
  readonly bubble: BubbleKind | null
  readonly ring: 'none' | 'soft' | 'strong'
  readonly glint: boolean
}

const BLOCKING_WITHOUT_ART: readonly NodeStatus[] = ['no_energy', 'no_tool', 'tool_tier', 'tool_broken', 'inventory_full']

/** Regrowth progress → which regrowing frame to draw. */
export function regrowFrame(progress: number): number {
  return Math.max(0, Math.min(REGROW_FRAMES - 1, Math.floor(progress * REGROW_FRAMES)))
}

export function forageVisual(input: ForageVisualInput): ForageVisualView {
  const base = { frame: 0, regrowProgress: 0, bubble: null, ring: 'none', glint: false } as const
  const marker: BubbleKind = input.needsTool ? 'sickle' : 'hand'

  if (input.gathering) return { ...base, visual: 'gathering', art: 'ready', ring: 'strong' }

  if (input.status === 'depleted') {
    if (input.respawnInSeconds > 0 && input.respawnSeconds > 0) {
      const progress = Math.max(0, Math.min(1, 1 - input.respawnInSeconds / input.respawnSeconds))
      // The plant is bare for the first half and puts out buds for the second.
      const art: ForageArtState = progress < 0.4 ? 'picked' : 'regrowing'
      return { ...base, visual: 'regrowing', art, frame: regrowFrame(progress), regrowProgress: progress, ring: input.targeted ? 'soft' : 'none' }
    }
    return { ...base, visual: 'picked', art: 'picked', ring: input.targeted ? 'soft' : 'none' }
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
    return {
      ...base, visual: 'interactable', art: 'ready', ring: 'soft', glint,
      bubble: BLOCKING_WITHOUT_ART.includes(input.status) || input.status === 'available' ? marker : null,
    }
  }
  return { ...base, visual: glint ? 'rare' : 'available', art: 'ready', glint }
}
