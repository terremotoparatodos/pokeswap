// Swap feature public API — R19
//
// The swap module owns the server boundary for swap execution and
// cooldown management. Client-side RNG for visual reveal is NOT
// exported from here — it belongs in the UI layer and has no
// effect on persistent state (INV-SWP-1, INV-SWP-3).

export type { SwapResult } from './api/swapApi'
export { swap, skipCooldown, getHistory } from './api/swapApi'

export { useSwap } from './composables/useSwap'
