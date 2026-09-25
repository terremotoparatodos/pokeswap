import { describe, it, expect, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { LOBBY_FEATURE_IDS } from '../../features/wildlands/lobby/features'
import { buildRoutes, routes } from './routes'
import routesSource from './routes.ts?raw'

const view = { default: { template: '<div />' } }
vi.mock('../../features/wildlands/components/WildlandsView.vue', () => view)
vi.mock('../../features/market/components/MarketView.vue', () => view)
vi.mock('../../features/swap/components/SwapView.vue', () => view)
vi.mock('../../features/dungeon/components/DungeonView.vue', () => view)
vi.mock('../../features/pokedex/components/PokedexView.vue', () => view)
vi.mock('../../features/progression/components/ProfileView.vue', () => view)
vi.mock('../../features/progression/components/MyBoxView.vue', () => view)

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

  it('redirects legacy map links to the city and keeps their query', async () => {
    const route = await open('/map?area=bosque')
    expect(route.name).toBe('lobby')
    expect(route.query).toEqual({ area: 'bosque' })
  })

  it('no longer serves the retired R31 profession playground (SKILLS-1)', async () => {
    expect((await open('/dev/profesiones')).name).toBe('lobby')
  })

  it('sends unknown paths to the city', async () => {
    expect((await open('/no-existe')).name).toBe('lobby')
  })
})

// Community Playtest 0.1: the doors open playtest surfaces, and a typed URL must
// not be a way around them. `buildRoutes(null)` is the table a playtest build
// registers (`PANEL_VIEWS` folds to null there).
describe('playtest routes', () => {
  async function openPlaytest(path: string) {
    const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes(null) })
    await router.push(path)
    return router.currentRoute.value
  }

  it.each(LOBBY_FEATURE_IDS)('sends a direct /%s to the town without loading its view', async id => {
    const route = await openPlaytest(`/${id}`)
    expect(route.name).toBe('lobby')
    expect(route.fullPath).toBe('/')
    expect(route.matched).toHaveLength(1)
  })

  it.each(['/market', '/profile', '/mercado/x', '/caja?publish=1'])('sends %s to the town', async path => {
    const route = await openPlaytest(path)
    expect(route.name).toBe('lobby')
    expect(route.matched).toHaveLength(1)
  })

  it('registers no route that names a production feature', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes(null) })
    for (const id of LOBBY_FEATURE_IDS) expect(router.hasRoute(id)).toBe(false)
  })

  it('gates the production views on the build flag, so a playtest bundle drops them', () => {
    const source = routesSource
    expect(source).toMatch(/const PANEL_VIEWS: PanelViews \| null = isPlaytest \? null : \{/)
    expect(source).toMatch(/export const routes: RouteRecordRaw\[\] = buildRoutes\(PANEL_VIEWS\)/)
  })
})
