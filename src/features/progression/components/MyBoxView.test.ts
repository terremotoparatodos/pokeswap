import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, readonly } from 'vue'
import MyBoxView from './MyBoxView.vue'

const mockLoad    = vi.fn()
const mockRefresh = vi.fn()
const mockPublish = vi.fn()

const _items = ref<unknown[]>([])

vi.mock('../composables/useMyBox', () => ({
  useMyBox: () => ({
    items:     readonly(_items),
    isLoading: readonly(ref(false)),
    error:     readonly(ref(null)),
    load:      (...args: unknown[]) => mockLoad(...args),
    refresh:   (...args: unknown[]) => mockRefresh(...args),
  }),
}))

vi.mock('../../market/api/marketApi', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
}))

const _user = ref<{ id: string } | null>({ id: 'u1' })

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({ user: readonly(_user) }),
}))

const PIKACHU = {
  slot: { pokemon_id: 25, is_locked: false, energy: 3 },
  pokemon: { id: 25, name_es: 'Pikachu', sprite_url: null, type1: 'electric', type2: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  _user.value = { id: 'u1' }
  _items.value = [PIKACHU]
  mockLoad.mockResolvedValue(undefined)
  mockRefresh.mockResolvedValue(undefined)
  mockPublish.mockResolvedValue(undefined)
})

describe('MyBoxView', () => {
  it('shows sign-in prompt when not authenticated', () => {
    _user.value = null
    const wrapper = mount(MyBoxView)
    expect(wrapper.find('.box-unauth').exists()).toBe(true)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it('loads the box of the signed-in user and lists it', async () => {
    const wrapper = mount(MyBoxView)
    await flushPromises()
    expect(mockLoad).toHaveBeenCalledWith('u1')
    expect(wrapper.findAll('.profile-box-card')).toHaveLength(1)
    expect(wrapper.find('.profile-box-name').text()).toBe('Pikachu')
  })

  it('publishes through the market API and refreshes the box', async () => {
    const wrapper = mount(MyBoxView)
    await flushPromises()
    await wrapper.find('.profile-box-btn--sell').trigger('click')
    await wrapper.find('.profile-box-price-input').setValue(120)
    await wrapper.find('.profile-box-btn--confirm').trigger('click')
    await flushPromises()
    expect(mockPublish).toHaveBeenCalledWith(25, 120)
    expect(mockRefresh).toHaveBeenCalledOnce()
  })
})
