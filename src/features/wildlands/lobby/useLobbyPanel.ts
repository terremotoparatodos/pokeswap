// Lobby panel state — R25
//
// Maps the current route to the feature panel open over the town, decides
// whether it may show (session), and closes it with the browser history so
// Back, Esc and the close button all behave the same.

import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../../auth/composables/useAuth'
import { devWarn } from '../../../shared/utils/devTools'
import { isLobbyFeature, panelAccess, type LobbyFeature } from './features'

/** How a panel was opened: walking into a building, from the menu, or a direct link. */
export type PanelOrigin = 'door' | 'menu' | 'link'

export interface LobbyPanelOptions {
  /** A panel closed and the town is back in view. */
  onClosed?: (feature: LobbyFeature, origin: PanelOrigin) => void
}

const isLobbyRoot = (path: unknown) => path === '/' || (typeof path === 'string' && path.startsWith('/?'))

export function useLobbyPanel(options: LobbyPanelOptions = {}) {
  const route = useRoute()
  const router = useRouter()
  const { user, isLoading, refreshProfile } = useAuth()

  const feature = computed<LobbyFeature | null>(() => (isLobbyFeature(route.name) ? route.name : null))
  const access = computed(() => panelAccess(feature.value, { isLoading: isLoading.value, signedIn: user.value !== null }))
  const title = computed(() => route.meta.panelTitle ?? '')

  let origin: PanelOrigin | null = feature.value ? 'link' : null

  function open(next: LobbyFeature, from: PanelOrigin): void {
    if (feature.value === next) return
    origin = from
    router.push({ name: next }).catch(error => devWarn('[lobby] could not open panel', error))
  }

  /** Back to the town: pops the history entry when the panel was opened from it. */
  function close(): void {
    if (!feature.value) return
    if (isLobbyRoot(router.options.history.state.back)) {
      router.back()
      return
    }
    // Direct link (or a panel reached from another panel): nothing in history to pop.
    router.replace({ path: '/' }).catch(error => devWarn('[lobby] could not close panel', error))
  }

  watch(feature, (next, prev) => {
    if (next && !origin) origin = 'menu' // e.g. browser Forward: nothing to walk back to.
    if (prev && !next) {
      const from = origin ?? 'menu'
      origin = null
      options.onClosed?.(prev, from)
      // Purchases, swaps or rewards may have moved the balance shown in the HUD.
      refreshProfile().catch(error => devWarn('[lobby] profile refresh failed', error))
    }
  })

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && feature.value) close()
  }
  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

  return { feature, access, title, open, close }
}
