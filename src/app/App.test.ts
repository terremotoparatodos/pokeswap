import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { ref, readonly } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from './App.vue'

vi.mock('../features/auth/composables/useAuth', () => ({
  useAuth: () => ({
    isLoading: readonly(ref(false)),
    profile: readonly(ref(null)),
    user: readonly(ref(null)),
  }),
}))

vi.mock('../shared/api/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}))

vi.mock('../features/auth/components/AuthModal.vue', () => ({
  default: { template: '<div />' },
}))

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
})

describe('App', () => {
  it('renders the nav bar', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await router.isReady()
    expect(wrapper.find('.app-logo').text()).toBe('PokeSwap')
  })

  it('shows sign-in button when not authenticated', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })
    await router.isReady()
    expect(wrapper.find('.app-nav-btn').text()).toBe('Ingresar')
  })
})
