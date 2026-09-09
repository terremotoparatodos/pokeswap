import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly, computed } from 'vue'
import MapView from './MapView.vue'

// ── API mocks ─────────────────────────────────────────────────────────────────
const mockFetchMapData      = vi.fn()
const mockFetchRecentActivity = vi.fn()

vi.mock('../api/mapApi', () => ({
  fetchMapData:       (...a: unknown[]) => mockFetchMapData(...a),
  fetchRecentActivity: (...a: unknown[]) => mockFetchRecentActivity(...a),
}))

// ── Composable mocks ──────────────────────────────────────────────────────────
const mockPan       = vi.fn()
const mockZoom      = vi.fn()
const mockSetScale  = vi.fn()
const mockReset     = vi.fn()
const _cameraState  = ref({ x: 0, y: 0, scale: 1 })
const _transform    = computed(() => `translate(0px,0px) scale(1)`)

vi.mock('../composables/useCamera', () => ({
  useCamera: () => ({
    state:     readonly(_cameraState),
    transform: readonly(_transform),
    pan:       mockPan,
    zoom:      mockZoom,
    setScale:  mockSetScale,
    reset:     mockReset,
  }),
}))

const mockSpawnAll       = vi.fn()
const mockApplySlotPatch = vi.fn()
const mockRotateWildPool = vi.fn()
const _entities          = ref<unknown[]>([])

vi.mock('../composables/useMapEntities', () => ({
  useMapEntities: () => ({
    entities:       readonly(computed(() => _entities.value)),
    spawnAll:       mockSpawnAll,
    applySlotPatch: mockApplySlotPatch,
    rotateWildPool: mockRotateWildPool,
  }),
}))

const mockSeedActivity   = vi.fn()
const _recentActivity    = ref<unknown[]>([])
const _connected         = ref(false)

vi.mock('../composables/useMapRealtime', () => ({
  useMapRealtime: (_: unknown) => ({
    recentActivity: readonly(_recentActivity),
    connected:      readonly(_connected),
    seedActivity:   mockSeedActivity,
  }),
}))

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({ user: readonly(ref({ id: 'u1' })) }),
}))

// ── Map config mock (avoid large imports) ─────────────────────────────────────
vi.mock('../data/mapConfig', () => ({
  ZONES: [
    { name: 'hearthome', x: 0, y: 0, w: 100, h: 100, img: 'https://example.com/hearthome.png' },
  ],
  MAP_W:          100,
  MAP_H:          100,
  WILD_ROTATE_MS: 3_600_000,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────
const POKEMON = {
  id: 1, name_es: 'Bulbasaur', type1: 'grass', type2: 'poison',
  sprite_url: 'https://example.com/1.png', is_legendary: false,
  region: 'kanto', generation: 1, base_price: 100, base_aura: 10,
  locked: false, created_at: null,
}
const SLOT = {
  pokemon_id: 1, owner_id: 'u2', owner_username: 'ash',
  current_price: 500, claim_count: 1, is_locked: false,
  last_claimed_at: null, aura: null, aura_updated_at: null,
  owned_since: null, first_owner_id: null, first_owner_username: null,
  energy: null, energy_updated_at: null, link_url: null,
  link_text: null, created_at: null, updated_at: null,
}
const MAP_DATA = { pokemon: [POKEMON], slots: { 1: SLOT } }

beforeEach(() => {
  _entities.value      = []
  _recentActivity.value = []
  _connected.value     = false
  vi.clearAllMocks()
  mockFetchMapData.mockResolvedValue(MAP_DATA)
  mockFetchRecentActivity.mockResolvedValue([])
  mockSpawnAll.mockReturnValue(undefined)
  mockSeedActivity.mockReturnValue(undefined)
})

function mountView() {
  return mount(MapView, { attachTo: document.body })
}

describe('MapView', () => {
  it('renders the world container', () => {
    const wrapper = mountView()
    expect(wrapper.find('.map-container').exists()).toBe(true)
    expect(wrapper.find('.map-world').exists()).toBe(true)
  })

  it('renders zone tiles', () => {
    const wrapper = mountView()
    const imgs = wrapper.findAll('.map-world img')
    expect(imgs.length).toBeGreaterThanOrEqual(1)
    expect(imgs[0].attributes('src')).toContain('hearthome')
  })

  it('calls fetchMapData and fetchRecentActivity on mount', async () => {
    mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockFetchMapData).toHaveBeenCalledOnce()
    expect(mockFetchRecentActivity).toHaveBeenCalledOnce()
  })

  it('calls spawnAll with loaded data', async () => {
    mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSpawnAll).toHaveBeenCalledWith(
      MAP_DATA.pokemon, MAP_DATA.slots, 'u1',
    )
  })

  it('seeds activity feed', async () => {
    mockFetchRecentActivity.mockResolvedValue([{ id: 'a1', type: 'claim' }])
    mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSeedActivity).toHaveBeenCalledWith([{ id: 'a1', type: 'claim' }])
  })

  it('calls camera.reset() after load', async () => {
    mountView()
    await new Promise((r) => setTimeout(r, 0))
    expect(mockReset).toHaveBeenCalled()
  })

  it('renders entity buttons', () => {
    _entities.value = [
      { id: 1, pokemon: POKEMON, slot: SLOT, x: 50, y: 50, isWild: false },
    ]
    const wrapper = mountView()
    expect(wrapper.findAll('.map-entity')).toHaveLength(1)
    expect(wrapper.find('.map-entity img').attributes('src')).toBe('https://example.com/1.png')
  })

  it('shows selected entity panel on entity click', async () => {
    _entities.value = [
      { id: 1, pokemon: POKEMON, slot: SLOT, x: 50, y: 50, isWild: false },
    ]
    const wrapper = mountView()
    await wrapper.find('.map-entity').trigger('click')
    expect(wrapper.find('.map-panel').exists()).toBe(true)
    expect(wrapper.find('.map-panel-name').text()).toBe('Bulbasaur')
    expect(wrapper.find('.map-panel-owner').text()).toContain('ash')
  })

  it('closes panel on close button click', async () => {
    _entities.value = [
      { id: 1, pokemon: POKEMON, slot: SLOT, x: 50, y: 50, isWild: false },
    ]
    const wrapper = mountView()
    await wrapper.find('.map-entity').trigger('click')
    await wrapper.find('.map-panel-close').trigger('click')
    expect(wrapper.find('.map-panel').exists()).toBe(false)
  })

  it('shows activity feed when events exist', () => {
    _recentActivity.value = [
      { id: 'a1', type: 'claim', user_id: 'u1', pokemon_id: 25, created_at: null },
    ]
    const wrapper = mountView()
    expect(wrapper.find('.map-activity').exists()).toBe(true)
    expect(wrapper.find('.map-activity-item').text()).toContain('Captura')
  })

  it('shows connected status', () => {
    _connected.value = true
    const wrapper = mountView()
    expect(wrapper.find('.map-status').classes()).toContain('connected')
  })

  it('shows loading overlay during fetch', async () => {
    mockFetchMapData.mockImplementation(() => new Promise(() => {}))
    const wrapper = mountView()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-loading').exists()).toBe(true)
  })

  it('shows error when fetch fails', async () => {
    mockFetchMapData.mockRejectedValue(new Error('Network error'))
    const wrapper = mountView()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-load-error').text()).toContain('Network error')
  })

  it('shows fallback when entity has no sprite_url', () => {
    _entities.value = [
      { id: 25, pokemon: { ...POKEMON, id: 25, name_es: 'Pikachu', sprite_url: null }, slot: null, x: 50, y: 50, isWild: true },
    ]
    const wrapper = mountView()
    expect(wrapper.find('.map-entity-fallback').text()).toBe('P')
    expect(wrapper.find('img.map-entity-sprite').exists()).toBe(false)
  })
})
