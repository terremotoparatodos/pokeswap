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
  ],
})

export default router
