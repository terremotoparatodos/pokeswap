import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import EcoLimitedShell from './EcoLimitedShell.vue'
import { limitedEntry } from '../state/limitedEntry'

const auth = vi.hoisted(() => ({ user: null as unknown, loading: null as unknown, logout: vi.fn() }))
vi.mock('../../auth/composables/useAuth', () => ({ useAuth: () => ({ user: auth.user, isLoading: auth.loading }) }))
vi.mock('../../auth/api/authApi', () => ({ logout: auth.logout }))
vi.mock('../../auth/components/AuthModal.vue', () => ({ default: defineComponent({ props: { open: Boolean, loginOnly: Boolean }, template: '<div data-login v-if="open">LOGIN ONLY: {{ loginOnly }}</div>' }) }))
const user = ref<{ id: string } | null>(null), loading = ref(false)
auth.user = user; auth.loading = loading
beforeEach(() => { user.value = null; loading.value = false; limitedEntry.reset(); auth.logout.mockReset() })
const open = () => mount(EcoLimitedShell, { slots: { default: '<div data-world>world</div>' } })

describe('SCRIPTED limited shell (no hosted Auth)', () => {
  it('mounts no world for an absent/loading account and opens the existing login only', async () => {
    const w = open()
    expect(w.find('[data-world]').exists()).toBe(false)
    await w.find('button').trigger('click')
    expect(w.find('[data-login]').text()).toContain('true')
    user.value = { id: 'SCRIPTED-A' }; loading.value = true; await nextTick()
    expect(w.find('[data-world]').exists()).toBe(false)
    w.unmount()
  })
  it('holds the connecting world inert; denial/expiry unmount it; expiry offers no retry', async () => {
    user.value = { id: 'SCRIPTED-A' }
    const w = open()
    expect(w.find('[data-world]').element.parentElement?.hasAttribute('inert')).toBe(true)
    limitedEntry.ready(); await nextTick()
    expect(w.find('[data-world]').element.parentElement?.hasAttribute('inert')).toBe(false)
    limitedEntry.refuse(4403); await nextTick()
    expect(w.find('[data-world]').exists()).toBe(false)
    await w.find('.eco-limited-entry button').trigger('click')
    expect(w.find('[data-world]').exists()).toBe(true)
    limitedEntry.refuse(4408); await nextTick()
    expect(w.find('[data-world]').exists()).toBe(false)
    expect(w.find('.eco-limited-entry button').exists()).toBe(false)
    user.value = null; await nextTick()
    expect(w.text()).toContain('Ingresá')
    w.unmount()
  })
  it('an account change replaces the mounted world; logout uses the existing API', async () => {
    user.value = { id: 'SCRIPTED-A' }
    const w = open(), first = w.find('[data-world]').element
    limitedEntry.ready(); user.value = { id: 'SCRIPTED-B' }; await nextTick()
    expect(w.find('[data-world]').element).not.toBe(first)
    expect(limitedEntry.phase.value).toBe('connecting')
    auth.logout.mockImplementation(async () => { user.value = null })
    await w.find('header button').trigger('click'); await nextTick()
    expect(auth.logout).toHaveBeenCalledOnce()
    expect(w.find('[data-world]').exists()).toBe(false)
    w.unmount()
  })
})
