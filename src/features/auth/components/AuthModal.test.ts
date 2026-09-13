import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AuthModal from './AuthModal.vue'

// Prevent real Supabase calls from the useAuth composable at module load.
vi.mock('../../../shared/api/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

vi.mock('../api/authApi', () => ({
  loginWithEmail: vi.fn(),
  loginWithGoogle: vi.fn(),
  signUp: vi.fn(),
  resetPassword: vi.fn(),
}))

import { loginWithEmail, signUp } from '../api/authApi'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AuthModal — XSS rendering safety (R08)', () => {
  const HOSTILE = '<img src=x onerror="alert(1)"><script>evil()</script>'

  it('renders a login error as plain text, not HTML', async () => {
    vi.mocked(loginWithEmail).mockRejectedValue(new Error(HOSTILE))

    const wrapper = mount(AuthModal, { props: { open: true, initialTab: 'login' } })
    await wrapper.find('form').trigger('submit')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const errorEl = wrapper.find('.auth-error')
    expect(errorEl.exists()).toBe(true)
    // textContent must equal the raw string — no parsed tags.
    expect(errorEl.element.textContent).toBe(HOSTILE)
    // The hostile string must not have created an <img> or <script> inside the element.
    expect(errorEl.element.querySelector('img')).toBeNull()
    expect(errorEl.element.querySelector('script')).toBeNull()
  })

  it('renders a signup username-field error as plain text', async () => {
    const wrapper = mount(AuthModal, { props: { open: true, initialTab: 'signup' } })

    // Type a hostile username into the username field.
    const usernameInput = wrapper.find('input[autocomplete="username"]')
    await usernameInput.setValue(HOSTILE)
    await usernameInput.trigger('input')
    await wrapper.vm.$nextTick()

    const fieldError = wrapper.find('.auth-field-error')
    // Validation must have rejected it and shown a plain-text error.
    if (fieldError.exists()) {
      expect(fieldError.element.querySelector('img')).toBeNull()
      expect(fieldError.element.querySelector('script')).toBeNull()
    }
    // After normalization the username input value must not contain < or >.
    expect((usernameInput.element as HTMLInputElement).value).not.toContain('<')
    expect((usernameInput.element as HTMLInputElement).value).not.toContain('>')
  })

  it('renders a signup API error as plain text', async () => {
    vi.mocked(signUp).mockRejectedValue(new Error(HOSTILE))

    const wrapper = mount(AuthModal, { props: { open: true, initialTab: 'signup' } })
    // Supply a valid username so validation passes.
    const usernameInput = wrapper.find('input[autocomplete="username"]')
    await usernameInput.setValue('validuser')
    await usernameInput.trigger('input')
    await wrapper.find('input[type="email"]').setValue('a@b.com')
    await wrapper.find('input[type="password"]').setValue('password123')
    await wrapper.find('form').trigger('submit')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const errorEl = wrapper.find('.auth-error')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.element.textContent).toBe(HOSTILE)
    expect(errorEl.element.querySelector('img')).toBeNull()
  })
})
