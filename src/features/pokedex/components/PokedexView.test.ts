import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly } from 'vue'
import PokedexView from './PokedexView.vue'

const mockLoadEntries = vi.fn()
const mockListPokemon = vi.fn()

vi.mock('../api/pokedexApi', () => ({
  loadPokedexEntries: (...a: unknown[]) => mockLoadEntries(...a),
}))

vi.mock('../../pokemon/api/pokemonApi', () => ({
  listPokemon: (...a: unknown[]) => mockListPokemon(...a),
}))

const _user = ref<{ id: string } | null>({ id: 'u1' })

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({ user: readonly(_user) }),
}))

const BULBASAUR: Record<string, unknown> = {
  id: 1, name_es: 'Bulbasaur', type1: 'grass', type2: 'poison',
  sprite_url: 'https://example.com/1.png', is_legendary: false,
  region: 'kanto', generation: 1, base_price: 100, base_aura: 10,
  locked: false, created_at: null,
}
const PIKACHU: Record<string, unknown> = {
  id: 25, name_es: 'Pikachu', type1: 'electric', type2: null,
  sprite_url: null, is_legendary: false,
  region: 'kanto', generation: 1, base_price: 150, base_aura: 12,
  locked: false, created_at: null,
}

const ENTRY_BULBASAUR = { user_id: 'u1', pokemon_id: 1, registered_at: '2025-01-15T10:00:00Z' }
const ENTRY_PIKACHU   = { user_id: 'u1', pokemon_id: 25, registered_at: null }

beforeEach(() => {
  _user.value = { id: 'u1' }
  vi.clearAllMocks()
  mockLoadEntries.mockResolvedValue([])
  mockListPokemon.mockResolvedValue([BULBASAUR, PIKACHU])
})

function mountView() {
  return mount(PokedexView)
}

describe('PokedexView', () => {
  it('shows sign-in prompt when not authenticated', () => {
    _user.value = null
    const wrapper = mountView()
    expect(wrapper.find('.pokedex-unauth').exists()).toBe(true)
    expect(mockLoadEntries).not.toHaveBeenCalled()
  })

  it('loads entries and pokemon on mount', async () => {
    mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockLoadEntries).toHaveBeenCalledWith('u1')
    expect(mockListPokemon).toHaveBeenCalledOnce()
  })

  it('shows empty message when no registered pokemon', async () => {
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pokedex-empty').exists()).toBe(true)
  })

  it('shows registered pokemon grid', async () => {
    mockLoadEntries.mockResolvedValue([ENTRY_BULBASAUR, ENTRY_PIKACHU])
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    const cards = wrapper.findAll('.pokedex-card')
    expect(cards).toHaveLength(2)
  })

  it('renders pokemon name and types', async () => {
    mockLoadEntries.mockResolvedValue([ENTRY_BULBASAUR])
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pokedex-name').text()).toBe('Bulbasaur')
    const types = wrapper.findAll('.pokedex-type')
    expect(types.map((t) => t.text())).toEqual(['grass', 'poison'])
  })

  it('renders sprite when sprite_url present', async () => {
    mockLoadEntries.mockResolvedValue([ENTRY_BULBASAUR])
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    const img = wrapper.find('img.pokedex-sprite')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('https://example.com/1.png')
    expect(img.attributes('alt')).toBe('Bulbasaur')
  })

  it('renders placeholder when no sprite_url', async () => {
    mockLoadEntries.mockResolvedValue([ENTRY_PIKACHU])
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pokedex-sprite--placeholder').exists()).toBe(true)
    expect(wrapper.find('img.pokedex-sprite').exists()).toBe(false)
  })

  it('only shows pokemon the user registered', async () => {
    mockLoadEntries.mockResolvedValue([ENTRY_PIKACHU]) // only Pikachu
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    const cards = wrapper.findAll('.pokedex-card')
    expect(cards).toHaveLength(1)
    expect(wrapper.find('.pokedex-name').text()).toBe('Pikachu')
  })

  it('shows count of registered pokemon', async () => {
    mockLoadEntries.mockResolvedValue([ENTRY_BULBASAUR, ENTRY_PIKACHU])
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pokedex-count').text()).toContain('2')
  })

  it('shows error on load failure', async () => {
    mockLoadEntries.mockRejectedValue(new Error('RLS denied'))
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pokedex-error').text()).toContain('RLS denied')
  })
})
