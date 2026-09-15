// Fishing interaction prototype: cast, wait for a bite, reel before the bite ends.
//
// Only the timing lives here. Catching still resolves through the same R31-A
// gathering resolver; energy and wear are charged only on a catch, so a missed
// window costs time, not resources.

export type FishingPhase = 'idle' | 'waiting' | 'bite' | 'caught' | 'escaped'

export interface FishingState {
  readonly phase: FishingPhase
  readonly biteAt: number
  readonly biteEndsAt: number
}

export const FISHING_TIMING = { minWaitMs: 1500, maxWaitMs: 4000, biteWindowMs: 900 } as const

export const IDLE_FISHING: FishingState = { phase: 'idle', biteAt: 0, biteEndsAt: 0 }

export function castLine(now: number, random: () => number): FishingState {
  const biteAt = now + FISHING_TIMING.minWaitMs + random() * (FISHING_TIMING.maxWaitMs - FISHING_TIMING.minWaitMs)
  return { phase: 'waiting', biteAt, biteEndsAt: biteAt + FISHING_TIMING.biteWindowMs }
}

export function tickFishing(state: FishingState, now: number): FishingState {
  if (state.phase === 'waiting' && now >= state.biteAt) return now >= state.biteEndsAt ? { ...state, phase: 'escaped' } : { ...state, phase: 'bite' }
  if (state.phase === 'bite' && now >= state.biteEndsAt) return { ...state, phase: 'escaped' }
  return state
}

/** Reeling early scares the fish; reeling inside the window catches it. */
export function reelLine(state: FishingState, now: number): FishingState {
  const current = tickFishing(state, now)
  if (current.phase === 'bite') return { ...current, phase: 'caught' }
  if (current.phase === 'waiting') return { ...current, phase: 'escaped' }
  return current
}
