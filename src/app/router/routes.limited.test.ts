import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
vi.mock('../../features/wildlands/components/WildlandsView.vue', () => ({ default: { template: '<div />' } }))
afterEach(() => vi.unstubAllEnvs())
describe('limited production routes', () => {
  it('direct economic and debug URLs resolve only to the world; no feature view is registered', async () => {
    vi.stubEnv('PROD', true); vi.stubEnv('DEV', false); vi.stubEnv('VITE_PLAYTEST', 'on'); vi.stubEnv('VITE_ECO_RELEASE', 'limited'); vi.resetModules()
    const { routes } = await import('./routes')
    const router = createRouter({ history: createMemoryHistory(), routes })
    for (const path of ['/market', '/profile', '/mercado', '/dungeon', '/caja', '/perfil', '/swap', '/dev/dungeon', '/dev/city-lab', '/dev/superficies']) {
      await router.push(path)
      expect(router.currentRoute.value.name).toBe('lobby')
      expect(router.currentRoute.value.matched).toHaveLength(1)
    }
    expect(router.getRoutes().filter(r => r.components).map(r => r.name)).toEqual(['lobby'])
  })
})
