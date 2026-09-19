// Community Playtest 0.1 admits new players: sign-up is an authorized
// onboarding exception (COMMUNITY_PLAYTEST_0_1.md §3.1), so a playtest build
// offers the same login and sign-up as the normal product.

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
  loginWithGoogle: vi.fn().mockResolvedValue(undefined),
  signUp: vi.fn().mockResolvedValue({ user: {}, needsConfirmation: false }),
  resetPassword: vi.fn(),
}))

import { loginWithEmail, loginWithGoogle, signUp } from '../api/authApi'

beforeEach(() => { vi.clearAllMocks() })

describe('AuthModal in a playtest build', () => {
  it('signs up a new player by email', async () => {
    const wrapper = mount(AuthModal, { props: { open: true, initialTab: 'signup' } })
    expect(wrapper.text()).toContain('Registrarse')
    await wrapper.find('input[placeholder="Nombre de usuario"]').setValue('entrenador')
    await wrapper.find('input[type="email"]').setValue('nuevo@b.co')
    await wrapper.find('input[autocomplete="new-password"]').setValue('secret1')
    await wrapper.find('form').trigger('submit')
    await wrapper.vm.$nextTick()
    expect(signUp).toHaveBeenCalledWith('entrenador', 'nuevo@b.co', 'secret1')
    expect(wrapper.emitted('success')).toHaveLength(1)
  })

  it('logs in by email and offers Google', async () => {
    const wrapper = mount(AuthModal, { props: { open: true } })
    await wrapper.find('input[autocomplete="username"]').setValue('a@b.co')
    await wrapper.find('input[type="password"]').setValue('secret1')
    await wrapper.find('form').trigger('submit')
    expect(loginWithEmail).toHaveBeenCalledWith('a@b.co', 'secret1')
    await wrapper.find('.auth-btn-google').trigger('click')
    expect(loginWithGoogle).toHaveBeenCalledTimes(1)
  })
})
