// One line of guidance about the world ("hay cuevas cerca", "acercate a una
// roca"). Features only say what to show; the view owns where it goes, so the
// hints stack in one tray instead of each floating at its own `bottom`.

export type WorldHintTone = 'dungeon' | 'skills'

export interface WorldHint {
  readonly id: string
  readonly badge: string
  readonly tone: WorldHintTone
  readonly text: string
}

export interface WorldHintCover {
  /** The chat panel grows up from the same corner of the screen. */
  readonly chatOpen: boolean
  /** A profession action card sits where the tray would. */
  readonly actionOpen: boolean
}

/** The hints to draw, or none while a panel owns the bottom of the screen. */
export function visibleWorldHints(hints: readonly (WorldHint | null | undefined)[], cover: WorldHintCover): WorldHint[] {
  if (cover.chatOpen || cover.actionOpen) return []
  return hints.filter((hint): hint is WorldHint => !!hint)
}
