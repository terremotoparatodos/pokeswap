// Drives a `BattleState` from the render loop (D2).
//
// The only reason this exists is to turn frames into `tick(dt)`. It carries no
// rules: there is no pause here either, because there is nothing to pause — the
// loop runs while the component is mounted and stops when the battle ends.

import { onUnmounted, shallowRef, triggerRef, type ShallowRef } from 'vue'
import { tick, type BattleState } from '../domain/battle'

/** Clamped so a background tab that resumes does not resolve ten actions at once. */
const MAX_STEP = 1 / 20

/** Runs after the engine's own tick: this is how the Alpha's Boss Skills drive. */
export type BattleDriver = (battle: BattleState, dt: number) => void

export interface RealtimeBattle {
  readonly battle: ShallowRef<BattleState | null>
  readonly seconds: ShallowRef<number>
  start(state: BattleState, driver?: BattleDriver): void
  stop(): void
}

export function useRealtimeBattle(): RealtimeBattle {
  const battle = shallowRef<BattleState | null>(null)
  const seconds = shallowRef(0)
  let frame = 0
  let last = 0
  let driver: BattleDriver | null = null

  const stop = (): void => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  const loop = (now: number): void => {
    const state = battle.value
    if (!state) return
    const dt = Math.min(MAX_STEP, (now - last) / 1000)
    last = now
    if (dt > 0) {
      tick(state, dt)
      driver?.(state, dt)
      seconds.value = state.seconds
      triggerRef(battle)
    }
    if (state.outcome === 'ongoing') frame = requestAnimationFrame(loop)
    else frame = 0
  }

  const start = (state: BattleState, nextDriver?: BattleDriver): void => {
    stop()
    battle.value = state
    driver = nextDriver ?? null
    seconds.value = 0
    last = performance.now()
    frame = requestAnimationFrame(loop)
  }

  onUnmounted(stop)
  return { battle, seconds, start, stop }
}
