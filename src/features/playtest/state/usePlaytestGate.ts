// The gate, as the app sees it.
//
// Singleton on purpose: the banner, the gate screen and the bug reporter all
// ask the same question, and two copies could disagree about whether the
// playtest is open.

import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue'
import { fetchGateConfig, GATE_POLL_MS } from '../api/gateApi'
import { codeMatches, resolveAccess, type PlaytestAccess, type PlaytestGateConfig } from '../domain/playtestGate'
import { isPlaytest, PLAYTEST_MODE } from '../playtestBuild'

/**
 * Where the accepted code is remembered. `sessionStorage`, not `localStorage`:
 * the code should not survive the browser, and it is a convenience, never an
 * authority (AGENTS §8).
 */
const CODE_KEY = 'pokeswap.playtest.code'

const config = ref<PlaytestGateConfig | null>(null)
const submittedCode = ref<string | null>(readStoredCode())
const wrongCode = ref(false)
let started = false
let poll: ReturnType<typeof setInterval> | null = null

function readStoredCode(): string | null {
  try {
    return sessionStorage.getItem(CODE_KEY)
  } catch {
    return null
  }
}

function storeCode(code: string | null): void {
  try {
    if (code === null) sessionStorage.removeItem(CODE_KEY)
    else sessionStorage.setItem(CODE_KEY, code)
  } catch {
    // A browser with storage blocked still plays; it just re-asks on reload.
  }
}

async function refresh(): Promise<void> {
  const next = await fetchGateConfig()
  // No answer is not an answer: keep the last state read. A known CLOSED stays
  // closed, and before any answer the gate screen stays up ("checking").
  if (!next) return
  config.value = next
  // A code that stops matching (rotated mid-stream) sends the player back to
  // the form instead of leaving them in a state the gate no longer allows.
  if (!codeMatches(next.accessCode, submittedCode.value)) storeCode(null)
}

export interface PlaytestGate {
  readonly access: ComputedRef<PlaytestAccess>
  readonly config: Readonly<Ref<PlaytestGateConfig | null>>
  /** Starts the first read and the poll. Idempotent. */
  start(): void
  stop(): void
  submit(code: string): void
  /** Re-reads the gate now, without waiting for the poll. */
  recheck(): Promise<void>
}

export function usePlaytestGate(): PlaytestGate {
  const access = computed<PlaytestAccess>(() => resolveAccess({
    mode: PLAYTEST_MODE,
    config: config.value,
    submittedCode: submittedCode.value,
    wrongCode: wrongCode.value,
  }))

  return {
    access,
    config: readonly(config) as Readonly<Ref<PlaytestGateConfig | null>>,
    start(): void {
      if (!isPlaytest || started) return
      started = true
      void refresh()
      poll = setInterval(() => void refresh(), GATE_POLL_MS)
    },
    stop(): void {
      if (poll) clearInterval(poll)
      poll = null
      started = false
    },
    submit(code: string): void {
      const expected = config.value?.accessCode ?? null
      if (!codeMatches(expected, code)) {
        wrongCode.value = true
        return
      }
      wrongCode.value = false
      submittedCode.value = code
      storeCode(code)
    },
    recheck: refresh,
  }
}
