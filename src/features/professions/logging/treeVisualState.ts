// What a logging node looks like in the forest, without opening any UI.
//
// Same shape as the mining and fishing visual states: node status plus
// proximity and targeting become an art state, a marker, a ground ring and a
// glint. A felled tree becomes a stump and grows back through it.

import type { BubbleKind } from '../art/miningFx'
import type { TreeArtState } from '../art/loggingTrees'
import { regrowState } from '../art/loggingTrees'
import type { NodeStatus } from '../ui/nodeStatus'

export type TreeVisual =
  | 'available' | 'interactable' | 'targeted' | 'chopping'
  | 'stump' | 'regrowing' | 'locked_level' | 'special_access' | 'rare'

export interface TreeVisualInput {
  readonly status: NodeStatus
  /** Player stands beside the tree. */
  readonly adjacent: boolean
  readonly targeted: boolean
  readonly chopping: boolean
  readonly respawnInSeconds: number
  readonly respawnSeconds: number
  /** Hardwood and boreal trees glint inside the Pokémon's prospecting radius. */
  readonly rareTree: boolean
  readonly detected: boolean
}

export interface TreeVisualView {
  readonly visual: TreeVisual
  readonly art: TreeArtState
  /** 0..1 regrowth while the stump comes back. */
  readonly regrowProgress: number
  readonly bubble: BubbleKind | null
  readonly ring: 'none' | 'soft' | 'strong'
  readonly glint: boolean
}

const BLOCKING_WITHOUT_ART: readonly NodeStatus[] = ['no_energy', 'no_tool', 'tool_tier', 'tool_broken', 'inventory_full']

export function treeVisual(input: TreeVisualInput): TreeVisualView {
  const base = { regrowProgress: 0, bubble: null, ring: 'none', glint: false } as const

  if (input.chopping) return { ...base, visual: 'chopping', art: 'ready', ring: 'strong' }

  if (input.status === 'depleted') {
    if (input.respawnInSeconds > 0 && input.respawnSeconds > 0) {
      const progress = Math.max(0, Math.min(1, 1 - input.respawnInSeconds / input.respawnSeconds))
      return { ...base, visual: 'regrowing', art: regrowState(progress), regrowProgress: progress, ring: input.targeted ? 'soft' : 'none' }
    }
    return { ...base, visual: 'stump', art: 'stump', ring: input.targeted ? 'soft' : 'none' }
  }

  if (input.status === 'locked_level') {
    return { ...base, visual: 'locked_level', art: 'ready', bubble: input.adjacent || input.targeted ? 'lock' : null }
  }
  if (input.status === 'locked_access') {
    return { ...base, visual: 'special_access', art: 'ready', bubble: input.adjacent || input.targeted ? 'seal' : null, glint: input.detected && input.rareTree }
  }

  const glint = input.rareTree && input.detected
  if (input.targeted) return { ...base, visual: 'targeted', art: 'ready', ring: 'strong', glint }
  if (input.adjacent) {
    return {
      ...base, visual: 'interactable', art: 'ready', ring: 'soft', glint,
      bubble: BLOCKING_WITHOUT_ART.includes(input.status) || input.status === 'available' ? 'axe' : null,
    }
  }
  return { ...base, visual: glint ? 'rare' : 'available', art: 'ready', glint }
}
