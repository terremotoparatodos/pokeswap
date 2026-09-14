import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readonly, ref } from 'vue'
import LobbyMenu from './LobbyMenu.vue'

const mockLogout = vi.fn()
const _profile = ref<{ username: string; tokens: number } | null>(null)

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({ profile: readonly(_profile), isLoading: readonly(ref(false)) }),
}))

vi.mock('../../auth/api/authApi', () => ({
  logout: (...args: unknown[]) => mockLogout(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockLogout.mockResolvedValue(undefined)
  _profile.value = null
})

describe('LobbyMenu', () => {
  it('lists the six functions with the building that hosts each', () => {
    const wrapper = mount(LobbyMenu, { props: { open: true } })
    const items = wrapper.findAll('.lm-item:not(.lm-item--activity)')
    expect(items.map(i => i.find('.lm-item-title').text())).toEqual(['Mercado', 'Swap', 'Dungeon', 'Pokédex', 'Perfil', 'Mi caja'])
    expect(items[0].find('.lm-item-place').text()).toBe('Tienda')
  })

  it('closes and selects a function', async () => {
    const wrapper = mount(LobbyMenu, { props: { open: true } })
    await wrapper.findAll('.lm-item')[4].trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(wrapper.emitted('select')?.[0]).toEqual(['perfil'])
  })

  it('opens the activity board from the menu', async () => {
    const wrapper = mount(LobbyMenu, { props: { open: true } })
    await wrapper.find('.lm-item--activity').trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(wrapper.emitted('activity')).toHaveLength(1)
  })

  it('offers sign-in without a session and hides tokens', async () => {
    const wrapper = mount(LobbyMenu, { props: { open: true } })
    expect(wrapper.find('.lm-tokens').exists()).toBe(false)
    await wrapper.find('.lm-btn--primary').trigger('click')
    expect(wrapper.emitted('signIn')).toHaveLength(1)
  })

  it('shows the username (as text) and tokens read-only, and signs out', async () => {
    _profile.value = { username: '<b>ash</b>', tokens: 12500 }
    const wrapper = mount(LobbyMenu, { props: { open: true } })
    expect(wrapper.find('.lm-tokens').text()).toContain('12.500')
    expect(wrapper.find('.lm-user').text()).toBe('<b>ash</b>')
    expect(wrapper.find('.lm-user b').exists()).toBe(false)
    await wrapper.find('.lm-btn').trigger('click')
    await flushPromises()
    expect(mockLogout).toHaveBeenCalledOnce()
  })

  it('closes with Escape', async () => {
    const wrapper = mount(LobbyMenu, { props: { open: true } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })
})
