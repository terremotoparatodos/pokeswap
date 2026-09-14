import { describe, it, expect, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { LOBBY_FEATURE_IDS } from '../../features/wildlands/lobby/features'
import { routes } from './routes'

const view = { default: { template: '<div />' } }
vi.mock('../../features/wildlands/components/WildlandsView.vue', () => view)
vi.mock('../../features/market/components/MarketView.vue', () => view)
vi.mock('../../features/swap/components/SwapView.vue', () => view)
vi.mock('../../features/dungeon/components/DungeonView.vue', () => view)
vi.mock('../../features/pokedex/components/PokedexView.vue', () => view)
vi.mock('../../features/progression/components/ProfileView.vue', () => view)
vi.mock('../../features/progression/components/MyBoxView.vue', () => view)
vi.mock('../../features/map/components/MapView.vue', () => view)

async function open(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  return router.currentRoute.value
}

describe('lobby routes', () => {
  it('opens Ciudad Corazón at /', async () => {
    const route = await open('/')
    expect(route.name).toBe('lobby')
    expect(route.matched).toHaveLength(1)
  })

  it.each(LOBBY_FEATURE_IDS)('renders /%s as a panel over the lobby', async id => {
    const route = await open(`/${id}`)
    expect(route.name).toBe(id)
    // The town stays mounted: the lobby is the parent record.
    expect(route.matched.map(r => r.name)).toEqual(['lobby', id])
    expect(route.meta.panelTitle).toBeTruthy()
  })

  it('redirects pre-R25 links', async () => {
    expect((await open('/market')).name).toBe('mercado')
    expect((await open('/profile')).name).toBe('perfil')
  })

  it('keeps the spawn query when redirecting /wildlands', async () => {
    const route = await open('/wildlands?area=costa&x=3&y=4')
    expect(route.name).toBe('lobby')
    expect(route.query).toEqual({ area: 'costa', x: '3', y: '4' })
  })

  it('keeps the legacy map as a standalone page', async () => {
    const route = await open('/map')
    expect(route.meta.standalone).toBe(true)
    expect(route.matched).toHaveLength(1)
  })

  it('sends unknown paths to the city', async () => {
    expect((await open('/no-existe')).name).toBe('lobby')
  })
})
