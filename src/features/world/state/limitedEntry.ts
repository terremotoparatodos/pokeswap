import { readonly, ref } from 'vue'
import { LIMITED_ACCESS_DENIED, LIMITED_ACCESS_EXPIRED } from '../../../../services/realtime/src/protocol/limitedAccess.js'

export type LimitedEntryPhase = 'connecting' | 'ready' | 'denied' | 'expired'
const phase = ref<LimitedEntryPhase>('connecting')

/** Presentation of the one presence socket. Never an admission authority. */
export const limitedEntry = {
  phase: readonly(phase),
  reset: () => { phase.value = 'connecting' },
  ready: () => { phase.value = 'ready' },
  lost: () => { if (phase.value === 'ready') phase.value = 'connecting' },
  refuse(code: unknown): boolean {
    if (code !== LIMITED_ACCESS_DENIED && code !== LIMITED_ACCESS_EXPIRED) return false
    phase.value = code === LIMITED_ACCESS_EXPIRED ? 'expired' : 'denied'
    return true
  },
}
