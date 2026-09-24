// Glue between WildlandsView and the PERF-1 session, so the view gains only a
// few lines. Loaded dynamically, and only by VITE_PERF=on builds.

import { nextTick } from 'vue'
import type { WildlandsGame } from '../engine/game'
import type { RemoteActorsPort } from '../multiplayer/domain/presence'
import { perfSession } from './perfSession'

export interface PerfCapture {
  readonly session: ReturnType<typeof perfSession>
  /** URL options: ?perfScenario=city-loop&perfLabel=pc-144hz starts a scripted capture. */
  readonly autoScenario: string | null
  readonly autoLabel: string | null
  attach(game: WildlandsGame): void
  port(game: WildlandsGame): RemoteActorsPort
  /** Wraps one HUD assignment and measures it through the Vue flush that follows. */
  measureHud(apply: () => void): void
  detach(): void
}

export function usePerfCapture(): PerfCapture {
  const session = perfSession()
  const query = new URLSearchParams(window.location.search)
  const scenario = query.get('perfScenario')
  return {
    session,
    autoScenario: scenario && /^[a-z-]{1,32}$/.test(scenario) ? scenario : null,
    autoLabel: query.get('perfLabel')?.replace(/[^\w-]/g, '').slice(0, 40) ?? null,
    attach: game => {
      session.install(game)
      // Console/automation handle for measurement builds (this module never ships otherwise).
      ;(window as unknown as { __pokeswapPerf?: unknown }).__pokeswapPerf = { session, game }
    },
    port: game => session.wrapPort(game),
    measureHud: apply => {
      const started = performance.now()
      apply()
      void nextTick(() => session.hudFlush(performance.now() - started))
    },
    detach: () => {
      session.uninstall()
      delete (window as unknown as { __pokeswapPerf?: unknown }).__pokeswapPerf
    },
  }
}
