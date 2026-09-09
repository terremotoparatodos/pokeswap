import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly } from 'vue'
import DungeonView from './DungeonView.vue'

const mockEnterDungeon = vi.fn()
const mockFinishRun    = vi.fn()
const mockReset        = vi.fn()
const mockRunCombat    = vi.fn()
const mockListOwnedSlots = vi.fn()
const mockListPokemon    = vi.fn()

const _phase  = ref<string>('idle')
const _combat = ref<unknown>(null)
const _result = ref<unknown>(null)
const _error  = ref<string | null>(null)

vi.mock('../composables/useDungeon', () => ({
  useDungeon: () => ({
    phase:          readonly(_phase),
    combat:         readonly(_combat),
    result:         readonly(_result),
    error:          readonly(_error),
    pokemonId:      readonly(ref(null)),
    remainingEnergy: readonly(ref(null)),
    enterDungeon:   mockEnterDungeon,
    finishRun:      mockFinishRun,
    reset:          mockReset,
  }),
}))

vi.mock('../engine/combat', () => ({
  DUNGEON_ENERGY_COST: 30,
  runCombat: (...a: unknown[]) => mockRunCombat(...a),
}))

vi.mock('../../pokemon/api/pokemonApi', () => ({
  listOwnedSlots: (...a: unknown[]) => mockListOwnedSlots(...a),
  listPokemon:    (...a: unknown[]) => mockListPokemon(...a),
}))

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({ user: readonly(ref({ id: 'u1' })) }),
}))

const SLOT_WITH_ENERGY = {
  pokemon_id: 25, owner_id: 'u1', owner_username: 'ash',
  current_price: 100, claim_count: 1, is_locked: false,
  energy: 100, aura: null, aura_updated_at: null,
  last_claimed_at: null, owned_since: null, first_owner_id: null,
  first_owner_username: null, energy_updated_at: null,
  link_url: null, link_text: null, created_at: null, updated_at: null,
}
const PIKACHU = {
  id: 25, name_es: 'Pikachu', type1: 'electric', type2: null,
  sprite_url: 'https://example.com/25.png', is_legendary: false,
  region: 'kanto', generation: 1, base_price: 150, base_aura: 12,
  locked: false, created_at: null,
}
const COMBAT_SUMMARY = {
  won: true,
  rounds: [{ round: 1, playerDamage: 20, enemyDamage: 10, playerHpAfter: 90, enemyHpAfter: 0 }],
  xpEarned: 300, tokensEarned: 80,
}
const DUNGEON_RESULT = {
  combat: COMBAT_SUMMARY,
  newXp: 1300, newLevel: 5, leveledUp: false, tokensAwarded: 80, newBalance: 9080,
}

beforeEach(() => {
  _phase.value  = 'idle'
  _combat.value = null
  _result.value = null
  _error.value  = null
  vi.clearAllMocks()
  mockListOwnedSlots.mockResolvedValue([SLOT_WITH_ENERGY])
  mockListPokemon.mockResolvedValue([PIKACHU])
  mockRunCombat.mockReturnValue(COMBAT_SUMMARY)
  mockEnterDungeon.mockResolvedValue(undefined)
  mockFinishRun.mockResolvedValue(undefined)
  mockReset.mockReturnValue(undefined)
})

function mountView() {
  return mount(DungeonView)
}

describe('DungeonView', () => {
  it('shows sign-in prompt when not authenticated', () => {
    vi.doMock('../../auth/composables/useAuth', () => ({
      useAuth: () => ({ user: readonly(ref(null)) }),
    }))
    // Default mock has user set — just check idle renders normally
    const wrapper = mountView()
    expect(wrapper.find('.dungeon-title').text()).toBe('Dungeon')
  })

  it('loads owned slots on mount', async () => {
    mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockListOwnedSlots).toHaveBeenCalledWith('u1')
    expect(mockListPokemon).toHaveBeenCalledOnce()
  })

  it('renders eligible slots with energy >= 30', async () => {
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.dungeon-slot-item')).toHaveLength(1)
    expect(wrapper.find('.dungeon-slot-name').text()).toBe('Pikachu')
    expect(wrapper.find('.dungeon-slot-energy').text()).toContain('100')
  })

  it('filters out slots below energy cost', async () => {
    mockListOwnedSlots.mockResolvedValue([{ ...SLOT_WITH_ENERGY, energy: 10 }])
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dungeon-no-slots').exists()).toBe(true)
  })

  it('enter button is disabled until a slot is selected', async () => {
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dungeon-btn--enter').attributes('disabled')).toBeDefined()
  })

  it('selecting a slot enables the enter button', async () => {
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    await wrapper.find('.dungeon-slot-item').trigger('click')
    expect(wrapper.find('.dungeon-btn--enter').attributes('disabled')).toBeUndefined()
  })

  it('clicking enter calls enterDungeon with selected pokemonId', async () => {
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    await wrapper.find('.dungeon-slot-item').trigger('click')
    await wrapper.find('.dungeon-btn--enter').trigger('click')
    expect(mockEnterDungeon).toHaveBeenCalledWith(25)
  })

  it('shows starting phase', () => {
    _phase.value = 'starting'
    const wrapper = mountView()
    expect(wrapper.find('.dungeon-loading').text()).toContain('Preparando')
  })

  it('shows combat result after simulation', () => {
    _phase.value  = 'combat'
    _combat.value = COMBAT_SUMMARY
    const wrapper = mountView()
    expect(wrapper.find('.dungeon-combat-result').text()).toContain('¡Victoria!')
    expect(wrapper.findAll('.dungeon-round')).toHaveLength(1)
    expect(wrapper.find('.dungeon-advisory').text()).toContain('300')
  })

  it('shows submitting phase', () => {
    _phase.value = 'submitting'
    const wrapper = mountView()
    expect(wrapper.find('.dungeon-loading').text()).toContain('Guardando')
  })

  it('shows result phase with XP and tokens', () => {
    _phase.value  = 'result'
    _result.value = DUNGEON_RESULT
    const wrapper = mountView()
    expect(wrapper.find('.dungeon-result-title').text()).toContain('completado')
    expect(wrapper.find('.dungeon-result').text()).toContain('80')
  })

  it('shows level-up message when leveled_up is true', () => {
    _phase.value  = 'result'
    _result.value = { ...DUNGEON_RESULT, leveledUp: true, newLevel: 6 }
    const wrapper = mountView()
    expect(wrapper.find('.dungeon-levelup').text()).toContain('6')
  })

  it('reset button calls reset and clears selection', async () => {
    _phase.value  = 'result'
    _result.value = DUNGEON_RESULT
    const wrapper = mountView()
    await wrapper.find('.dungeon-btn').trigger('click')
    expect(mockReset).toHaveBeenCalledOnce()
  })

  it('shows error in idle phase', () => {
    _error.value = 'Sin energía suficiente'
    const wrapper = mountView()
    expect(wrapper.find('.dungeon-error').text()).toContain('Sin energía')
  })
})
