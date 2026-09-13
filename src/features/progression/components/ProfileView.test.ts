import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly } from 'vue'
import ProfileView from './ProfileView.vue'

const mockCollect  = vi.fn()
const mockGetLedger = vi.fn()

vi.mock('../api/progressionApi', () => ({
  collectPassiveTokens: (...args: unknown[]) => mockCollect(...args),
  getTokenLedger:       (...args: unknown[]) => mockGetLedger(...args),
}))

vi.mock('../composables/useMyBox', () => ({
  useMyBox: () => ({
    items:     readonly(ref([])),
    isLoading: readonly(ref(false)),
    error:     readonly(ref(null)),
    load:      vi.fn().mockResolvedValue(undefined),
    refresh:   vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../market/api/marketApi', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}))

const _user    = ref<{ id: string } | null>({ id: 'u1' })
const _profile = ref<{ username: string; tokens: number } | null>({
  username: 'ash',
  tokens: 5000,
})
const _loading = ref(false)

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({
    user:      readonly(_user),
    profile:   readonly(_profile),
    isLoading: readonly(_loading),
  }),
}))

beforeEach(() => {
  _user.value    = { id: 'u1' }
  _profile.value = { username: 'ash', tokens: 5000 }
  _loading.value = false
  vi.clearAllMocks()
  mockGetLedger.mockResolvedValue([])
  mockCollect.mockResolvedValue({ delta: 250, new_balance: 5250 })
})

function mountView() {
  return mount(ProfileView)
}

describe('ProfileView', () => {
  it('shows username and token balance', async () => {
    const wrapper = mountView()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.profile-stat-value').text()).toBe('ash')
    expect(wrapper.text()).toContain('5.000')
  })

  it('shows sign-in prompt when not authenticated', () => {
    _user.value    = null
    _profile.value = null
    const wrapper = mountView()
    expect(wrapper.find('.profile-unauth').exists()).toBe(true)
    expect(wrapper.find('.profile-stats').exists()).toBe(false)
  })

  it('loads ledger on mount', async () => {
    mountView()
    await new Promise((r) => setTimeout(r, 0))
    // Called at least once on mount; the user watch may add extra calls across test runs
    expect(mockGetLedger).toHaveBeenCalled()
  })

  it('calls collectPassiveTokens on button click', async () => {
    const wrapper = mountView()
    await wrapper.vm.$nextTick()
    await wrapper.find('.profile-btn').trigger('click')
    expect(mockCollect).toHaveBeenCalledOnce()
  })

  it('shows delta after successful collect', async () => {
    const wrapper = mountView()
    await wrapper.vm.$nextTick()
    await wrapper.find('.profile-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.profile-collect-msg').text()).toContain('+250')
  })

  it('updates displayed token balance after collect', async () => {
    const wrapper = mountView()
    await wrapper.vm.$nextTick()
    await wrapper.find('.profile-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.profile-stat-tokens').text()).toContain('5.250')
  })

  it('shows error when collect fails', async () => {
    mockCollect.mockRejectedValue(new Error('Rate limit exceeded'))
    const wrapper = mountView()
    await wrapper.vm.$nextTick()
    await wrapper.find('.profile-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.profile-error').text()).toContain('Rate limit exceeded')
  })

  it('renders ledger entries', async () => {
    mockGetLedger.mockResolvedValue([
      { id: 'l1', amount: 250, reason: 'passive', created_at: null, user_id: 'u1', related_transaction_id: null, pokemon_id: null },
      { id: 'l2', amount: -150, reason: 'learn_move', created_at: null, user_id: 'u1', related_transaction_id: null, pokemon_id: null },
    ])
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    const items = wrapper.findAll('.profile-ledger-item')
    expect(items).toHaveLength(2)
    expect(items[0].find('.positive').exists()).toBe(true)
    expect(items[1].find('.negative').exists()).toBe(true)
  })
})
