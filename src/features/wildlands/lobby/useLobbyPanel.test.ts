import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, readonly, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { LOBBY_FEATURE_IDS } from './features'
import { useLobbyPanel, type LobbyPanelOptions } from './useLobbyPanel'

const _user = ref<{ id: string } | null>(null)
const _loading = ref(false)
const refreshProfile = vi.fn().mockResolvedValue(undefined)

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({ user: readonly(_user), isLoading: readonly(_loading), refreshProfile }),
}))

const Empty = { render: () => null }

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: '/',
      name: 'lobby',
      component: { render: () => h(RouterView) },
      children: LOBBY_FEATURE_IDS.map(id => ({ path: id, name: id, component: Empty, meta: { panelTitle: id.toUpperCase() } })),
    }],
  })
}

async function setup(start: string, options: LobbyPanelOptions = {}) {
  const router = makeRouter()
  await router.push(start)
  let panel!: ReturnType<typeof useLobbyPanel>
  const Harness = defineComponent({
    setup() {
      panel = useLobbyPanel(options)
      return () => null
    },
  })
  const wrapper = mount(Harness, { global: { plugins: [router] } })
  return { router, panel, wrapper }
}

/** Memory-history `back()` notifies the router asynchronously. */
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await flushPromises()
}

beforeEach(() => {
  _user.value = { id: 'u1' }
  _loading.value = false
  vi.clearAllMocks()
})

describe('useLobbyPanel', () => {
  it('has no panel in the plain town', async () => {
    const { panel } = await setup('/')
    expect(panel.feature.value).toBeNull()
    expect(panel.access.value).toBe('closed')
  })

  it('opens a building panel and closes it back into the town with history', async () => {
    const onClosed = vi.fn()
    const { router, panel } = await setup('/', { onClosed })
    panel.open('swap', 'door')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('swap')
    expect(panel.title.value).toBe('SWAP')
    expect(panel.access.value).toBe('open')

    panel.close()
    await settle()
    expect(router.currentRoute.value.name).toBe('lobby')
    expect(onClosed).toHaveBeenCalledWith('swap', 'door')
    expect(refreshProfile).toHaveBeenCalledOnce()
  })

  it('treats the browser Back button like closing', async () => {
    const onClosed = vi.fn()
    const { router, panel } = await setup('/', { onClosed })
    panel.open('mercado', 'menu')
    await flushPromises()
    router.back()
    await settle()
    expect(panel.feature.value).toBeNull()
    expect(onClosed).toHaveBeenCalledWith('mercado', 'menu')
  })

  it('opens direct links with the panel already open and closes them to /', async () => {
    const onClosed = vi.fn()
    const { router, panel } = await setup('/pokedex', { onClosed })
    expect(panel.feature.value).toBe('pokedex')
    panel.close()
    await settle()
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(onClosed).toHaveBeenCalledWith('pokedex', 'link')
  })

  it('closes the panel with Escape', async () => {
    const { router, panel } = await setup('/')
    panel.open('perfil', 'menu')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(router.currentRoute.value.name).toBe('lobby')
  })

  it('gates account features on the session', async () => {
    _user.value = null
    const { panel } = await setup('/caja')
    expect(panel.access.value).toBe('auth')
    _user.value = { id: 'u1' }
    await flushPromises()
    expect(panel.access.value).toBe('open')
  })

  it('stops listening for Escape once unmounted', async () => {
    const { router, panel, wrapper } = await setup('/')
    panel.open('dungeon', 'menu')
    await flushPromises()
    wrapper.unmount()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    // Unmounting the app resets currentRoute, so check the history itself.
    expect(router.options.history.location).toBe('/dungeon')
  })
})
