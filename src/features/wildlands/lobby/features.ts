// Lobby features — PokeSwap functions opened from Ciudad Corazón
//
// Each feature is a child route of the lobby whose view renders in a panel
// over the town. Route names equal these ids, so buildings, the menu and the
// router all speak the same keys. The city only navigates: every read and
// write stays inside the reused feature views.

export type LobbyFeature = 'mercado' | 'swap' | 'dungeon' | 'pokedex' | 'perfil' | 'caja'

export interface LobbyFeatureInfo {
  title: string
  /** Opening it without a session shows the sign-in modal instead. */
  requiresAuth: boolean
}

export const LOBBY_FEATURES: Readonly<Record<LobbyFeature, LobbyFeatureInfo>> = {
  mercado: { title: 'Mercado', requiresAuth: false },
  swap: { title: 'Swap', requiresAuth: true },
  dungeon: { title: 'Dungeon', requiresAuth: true },
  pokedex: { title: 'Pokédex', requiresAuth: true },
  perfil: { title: 'Perfil', requiresAuth: true },
  caja: { title: 'Mi caja', requiresAuth: true },
}

/** Menu order. */
export const LOBBY_FEATURE_IDS = Object.keys(LOBBY_FEATURES) as readonly LobbyFeature[]

export function isLobbyFeature(name: unknown): name is LobbyFeature {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(LOBBY_FEATURES, name)
}

/**
 * - `closed`: no panel route.
 * - `open`: show the feature.
 * - `wait`: the session is still being restored.
 * - `auth`: needs a session the user doesn't have.
 */
export type PanelAccess = 'closed' | 'open' | 'wait' | 'auth'

export function panelAccess(feature: LobbyFeature | null, session: { isLoading: boolean; signedIn: boolean }): PanelAccess {
  if (!feature) return 'closed'
  if (!LOBBY_FEATURES[feature].requiresAuth || session.signedIn) return 'open'
  return session.isLoading ? 'wait' : 'auth'
}
