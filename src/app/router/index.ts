import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/swap',
      component: () => import('../../features/swap/components/SwapView.vue'),
    },
    {
      path: '/profile',
      component: () => import('../../features/progression/components/ProfileView.vue'),
    },
    {
      path: '/market',
      component: () => import('../../features/market/components/MarketView.vue'),
    },
    {
      path: '/pokedex',
      component: () => import('../../features/pokedex/components/PokedexView.vue'),
    },
    {
      path: '/map',
      component: () => import('../../features/map/components/MapView.vue'),
    },
    {
      path: '/dungeon',
      component: () => import('../../features/dungeon/components/DungeonView.vue'),
    },
  ],
})

export default router
