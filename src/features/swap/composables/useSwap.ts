// useSwap — R19
//
// Singleton reactive state for the current user's swap lifecycle.
// Cooldown authority: swap_cooldown_until from the server response (INV-SWP-2).
// The localStorage mirror used by the legacy client is advisory only and is
// not reproduced here — all cooldown decisions use this reactive ref.
//
// Consumers:
//   - Call syncCooldown(profile.swap_cooldown_until) when auth state loads.
//   - Call executeSwap() to initiate a swap; the composable updates cooldown
//     from the server result without a second profile read.
//   - Call skipCooldown() after the user confirms the 1,000-token debit.

import { ref, computed, readonly } from 'vue'
import { swap as apiSwap, skipCooldown as apiSkipCooldown, getHistory } from '../api/swapApi'
import type { SwapResult } from '../api/swapApi'
import type { SwapHistoryEntry } from '../../../shared/types/database'

// ── Module-level singleton ────────────────────────────────────────────────────

const _cooldownUntil = ref<string | null>(null)
const _isSwapping    = ref(false)
const _history       = ref<SwapHistoryEntry[]>([])
const _historyLoading = ref(false)

// ── Exported composable ───────────────────────────────────────────────────────

export function useSwap() {
  const canSwap = computed(() => {
    if (!_cooldownUntil.value) return true
    return new Date(_cooldownUntil.value) <= new Date()
  })

  // Seconds until the cooldown expires; 0 when canSwap is true.
  const secondsRemaining = computed(() => {
    if (!_cooldownUntil.value) return 0
    const ms = new Date(_cooldownUntil.value).getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / 1000))
  })

  // Called by useAuth after session init or profile refresh so the composable
  // starts in sync without an extra network call.
  function syncCooldown(swapCooldownUntil: string | null): void {
    _cooldownUntil.value = swapCooldownUntil
  }

  // Server-authoritative swap (INV-SWP-1).
  // pokemonGivenId omitted → server picks randomly from the user's eligible pool.
  async function executeSwap(pokemonGivenId?: number): Promise<SwapResult> {
    _isSwapping.value = true
    try {
      const result = await apiSwap(pokemonGivenId)
      _cooldownUntil.value = result.swap_cooldown_until
      return result
    } finally {
      _isSwapping.value = false
    }
  }

  // TKN-4 (R10): skip_swap_cooldown RPC debits 1,000 tokens server-side.
  // Clears the local cooldown mirror immediately on success.
  async function skipCooldown(): Promise<{ new_balance: number }> {
    const result = await apiSkipCooldown()
    _cooldownUntil.value = null
    return result
  }

  async function loadHistory(): Promise<void> {
    _historyLoading.value = true
    try {
      _history.value = await getHistory()
    } finally {
      _historyLoading.value = false
    }
  }

  return {
    cooldownUntil:  readonly(_cooldownUntil),
    canSwap,
    secondsRemaining,
    isSwapping:     readonly(_isSwapping),
    history:        readonly(_history),
    historyLoading: readonly(_historyLoading),
    syncCooldown,
    executeSwap,
    skipCooldown,
    loadHistory,
  }
}

// Exposed for tests that need to reset module state between cases.
export function _resetSwapState(): void {
  _cooldownUntil.value  = null
  _isSwapping.value     = false
  _history.value        = []
  _historyLoading.value = false
}
