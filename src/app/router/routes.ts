// Route table — R25.
//
// "/" is Ciudad Corazón. PokeSwap features are its child routes and render in
// a panel over the town, which stays mounted underneath. Route names equal the
// lobby feature ids (features/wildlands/lobby/features.ts).

import type { RouteComponent, RouteRecordRaw } from 'vue-router'
import { LOBBY_FEATURE_IDS, LOBBY_FEATURES, type LobbyFeature } from '../../features/wildlands/lobby/features'

declare module 'vue-router' {
  interface RouteMeta {
    /** Heading of the lobby panel that renders this route. */
    panelTitle?: string
    /** Full page outside the lobby (no town underneath). */
    standalone?: boolean
  }
}

type LazyView =() => Promise<RouteComponent>

const PANEL_VIEWS: Record<LobbyFeature, LazyView> = {
  mercado: () => import('../../features/market/components/MarketView.vue'),
  swap: () => import('../../features/swap/components/SwapView.vue'),
  dungeon: () => import('../../features/dungeon/components/DungeonView.vue'),
  pokedex: () => import('../../features/pokedex/components/PokedexView.vue'),
  perfil: () => import('../../features/progression/components/ProfileView.vue'),
  caja: () => import('../../features/progression/components/MyBoxView.vue'),
}

// R31-B: internal profession playground. Development builds only; production has no such route.
const professionPlayground: LazyView | null = import.meta.env.DEV ? () => import('../../features/professions/components/playground/ProfessionPlayground.vue') : null

// D0: Dungeon/PvE prototype labs, same rule — production never registers the
// route, so the chunk is unreachable and tree-shaken out of the bundle.
const dungeonPrototype: LazyView | null = import.meta.env.DEV ? () => import('../../features/dungeonPrototype/components/DungeonPrototypeView.vue') : null

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'lobby',
    component: () => import('../../features/wildlands/components/WildlandsView.vue'),
    children: LOBBY_FEATURE_IDS.map(id => ({
      path: id,
      name: id,
      component: PANEL_VIEWS[id],
      meta: { panelTitle: LOBBY_FEATURES[id].title },
    })),
  },
  // Pre-R25 links.
  { path: '/market', redirect: to => ({ name: 'mercado', query: to.query }) },
  { path: '/profile', redirect: to => ({ name: 'perfil', query: to.query }) },
  { path: '/wildlands', redirect: to => ({ path: '/', query: to.query }) },
  // Legacy map links now enter Ciudad Corazón.
  { path: '/map', redirect: to => ({ path: '/', query: to.query }) },
  ...(professionPlayground
    ? [{ path: '/dev/profesiones', name: 'dev-profesiones', component: professionPlayground, meta: { standalone: true } }]
    : []),
  ...(dungeonPrototype
    ? [{ path: '/dev/dungeon', name: 'dev-dungeon', component: dungeonPrototype, meta: { standalone: true } }]
    : []),
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
