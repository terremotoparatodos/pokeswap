// Community Playtest 0.1: log in with an existing account, never sign up.
// Sign-up creates an auth user and upserts `profiles`; a playtest build writes
// nothing persistent.

import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AuthModal from './AuthModal.vue'

vi.mock('../../playtest/playtestBuild', () => ({ isPlaytest: true, PLAYTEST_MODE: 'on' }))
vi.mock('../../../shared/api/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))
vi.mock('../api/authApi', () => ({
  loginWithEmail: vi.fn().mockResolvedValue({}),
  loginWithGoogle: vi.fn(),
  signUp: vi.fn(),
  resetPassword: vi.fn(),
}))

import { loginWithEmail, signUp } from '../api/authApi'

beforeEach(() => { vi.clearAllMocks() })

describe('AuthModal in a playtest build', () => {
  it('offers no sign-up tab or form, even when asked to open on it', async () => {
    const wrapper = mount(AuthModal, { props: { open: true, initialTab: 'signup' } })
    expect(wrapper.text()).not.toContain('Registrarse')
    expect(wrapper.find('input[autocomplete="new-password"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('El registro está cerrado')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true, initialTab: 'signup' })
    expect(wrapper.find('input[autocomplete="new-password"]').exists()).toBe(false)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('still logs in with an existing account', async () => {
    const wrapper = mount(AuthModal, { props: { open: true } })
    await wrapper.find('input[autocomplete="username"]').setValue('a@b.co')
    await wrapper.find('input[type="password"]').setValue('secret1')
    await wrapper.find('form').trigger('submit')
    await wrapper.vm.$nextTick()
    expect(loginWithEmail).toHaveBeenCalledWith('a@b.co', 'secret1')
    expect(wrapper.emitted('success')).toHaveLength(1)
    expect(signUp).not.toHaveBeenCalled()
  })
})
