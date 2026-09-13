import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly, computed } from 'vue'
import SwapView from './SwapView.vue'

const mockExecuteSwap = vi.fn()
const mockSkipCooldown = vi.fn()
const mockLoadHistory = vi.fn()
const mockSyncCooldown = vi.fn()

const _canSwap = ref(true)
const _isSwapping = ref(false)
const _history = ref<unknown[]>([])
const _historyLoading = ref(false)
const _secondsRemaining = ref(0)

vi.mock('../composables/useSwap', () => ({
  useSwap: () => ({
    canSwap: computed(() => _canSwap.value),
    secondsRemaining: computed(() => _secondsRemaining.value),
    isSwapping: readonly(_isSwapping),
    history: readonly(_history),
    historyLoading: readonly(_historyLoading),
    syncCooldown: mockSyncCooldown,
    executeSwap: mockExecuteSwap,
    skipCooldown: mockSkipCooldown,
    loadHistory: mockLoadHistory,
  }),
}))

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({
    user: readonly(ref({ id: 'u1' })),
    profile: readonly(ref({ swap_cooldown_until: null })),
    isLoading: readonly(ref(false)),
  }),
}))

vi.mock('../../pokemon/api/pokemonApi', () => ({
  getPokemon: vi.fn().mockResolvedValue({
    id: 1, name_es: 'Bulbasaur', sprite_url: null, type1: 'grass', type2: null,
  }),
}))

function mountView() {
  return mount(SwapView, { global: { stubs: { teleport: true } } })
}

beforeEach(() => {
  _canSwap.value = true
  _isSwapping.value = false
  _history.value = []
  _historyLoading.value = false
  _secondsRemaining.value = 0
  vi.clearAllMocks()
  mockLoadHistory.mockResolvedValue(undefined)
  mockExecuteSwap.mockResolvedValue({
    pokemon_given_id: 1,
    pokemon_received_id: 25,
    was_shiny: false,
    rarity: 'common',
    swap_cooldown_until: '2099-01-01T00:00:00Z',
  })
  mockSkipCooldown.mockResolvedValue({ new_balance: 9000 })
})

describe('SwapView', () => {
  it('shows swap button when ready', () => {
    const wrapper = mountView()
    expect(wrapper.find('.swap-btn').text()).toBe('¡Hacer Swap!')
  })

  it('shows cooldown section when canSwap is false', () => {
    _canSwap.value = false
    _secondsRemaining.value = 90
    const wrapper = mountView()
    expect(wrapper.find('.swap-cooldown-msg').exists()).toBe(true)
    expect(wrapper.find('.swap-btn--skip').exists()).toBe(true)
  })

  it('calls executeSwap on swap button click', async () => {
    const wrapper = mountView()
    await wrapper.find('.swap-btn').trigger('click')
    expect(mockExecuteSwap).toHaveBeenCalledOnce()
  })

  it('shows result after successful swap', async () => {
    const wrapper = mountView()
    await wrapper.find('.swap-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.swap-result').exists()).toBe(true)
    // Names come from the mocked getPokemon (always returns Bulbasaur)
    expect(wrapper.find('.swap-result').text()).toContain('Bulbasaur')
  })

  it('shows shiny indicator when swap result is shiny', async () => {
    mockExecuteSwap.mockResolvedValue({
      pokemon_given_id: 1,
      pokemon_received_id: 6,
      was_shiny: true,
      rarity: 'rare',
      swap_cooldown_until: '2099-01-01T00:00:00Z',
    })
    const wrapper = mountView()
    await wrapper.find('.swap-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.swap-shiny').exists()).toBe(true)
  })

  it('calls skipCooldown on skip button click', async () => {
    _canSwap.value = false
    _secondsRemaining.value = 30
    const wrapper = mountView()
    await wrapper.find('.swap-btn--skip').trigger('click')
    expect(mockSkipCooldown).toHaveBeenCalledOnce()
  })

  it('shows error message when swap fails', async () => {
    mockExecuteSwap.mockRejectedValue(new Error('Edge Function error'))
    const wrapper = mountView()
    await wrapper.find('.swap-btn').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.swap-error').text()).toContain('Edge Function error')
  })

  it('renders history entries', () => {
    _history.value = [
      { id: 'h1', pokemon_given_id: 1, pokemon_received_id: 25, was_shiny: false, rarity: 'common', created_at: null },
    ]
    const wrapper = mountView()
    expect(wrapper.findAll('.swap-history-item')).toHaveLength(1)
  })

  it('syncs cooldown from profile on mount', () => {
    mountView()
    expect(mockSyncCooldown).toHaveBeenCalledWith(null)
  })

  it('calls loadHistory on mount', () => {
    mountView()
    expect(mockLoadHistory).toHaveBeenCalledOnce()
  })
})
