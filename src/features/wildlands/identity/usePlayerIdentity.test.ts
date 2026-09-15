import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, readonly, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'
import { writePlayerPreferences } from './playerPreferences'
import { usePlayerIdentity } from './usePlayerIdentity'

const authUser = ref<{ id: string } | null>(null)
const authProfile = ref<{ id: string; username: string } | null>(null)
const authLoading = ref(true)
const boxItems = ref<SlotWithPokemon[]>([])
const boxLoading = ref(false)
const boxError = ref<string | null>(null)
const boxUser = ref<string | null>(null)
const serverItems = ref<SlotWithPokemon[]>([])

const loadBox = vi.fn(async (userId: string) => {
  boxUser.value = userId
  boxItems.value = serverItems.value
})
const clearBox = vi.fn(() => {
  boxUser.value = null
  boxItems.value = []
})

vi.mock('../../auth/composables/useAuth', () => ({
  useAuth: () => ({ user: readonly(authUser), profile: readonly(authProfile), isLoading: readonly(authLoading) }),
}))

vi.mock('../../progression/composables/useMyBox', () => ({
  useMyBox: () => ({
    items: readonly(boxItems), isLoading: readonly(boxLoading), error: readonly(boxError),
    activeUserId: readonly(boxUser), load: loadBox, refresh: loadBox, clear: clearBox,
  }),
}))

function ownedPikachu(): SlotWithPokemon {
  return {
    slot: { pokemon_id: 25, owner_id: 'u1', is_locked: false } as SlotWithPokemon['slot'],
    pokemon: { id: 25, name_es: 'Pikachu', sprite_url: 'pikachu.png' } as SlotWithPokemon['pokemon'],
  }
}

describe('usePlayerIdentity session lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    authUser.value = null
    authProfile.value = null
    authLoading.value = true
    boxItems.value = []
    boxUser.value = null
    serverItems.value = []
    vi.clearAllMocks()
  })

  it('applies a late session only after server ownership resolves, then clears it on logout', async () => {
    writePlayerPreferences('u1', {
      version: 1,
      characterId: 'dawn-pink',
      companionPokemonId: 25,
      townPosition: { tx: 20, ty: 30, dir: 'left' },
    })
    serverItems.value = [ownedPikachu()]
    const game = { setPlayerIdentity: vi.fn() }
    const wrapper = mount(defineComponent({
      setup() {
        usePlayerIdentity(shallowRef(game))
        return () => null
      },
    }))
    expect(game.setPlayerIdentity).toHaveBeenLastCalledWith(expect.objectContaining({ username: null, companion: null }))

    authUser.value = { id: 'u1' }
    authProfile.value = { id: 'u1', username: '<b>Ash</b>' }
    authLoading.value = false
    await flushPromises()
    expect(loadBox).toHaveBeenCalledWith('u1')
    expect(game.setPlayerIdentity).toHaveBeenLastCalledWith(expect.objectContaining({
      username: '<b>Ash</b>',
      character: expect.objectContaining({ id: 'dawn-pink' }),
      companion: { id: 25, name_es: 'Pikachu', sprite_url: 'pikachu.png' },
    }))

    authUser.value = null
    authProfile.value = null
    await flushPromises()
    expect(clearBox).toHaveBeenCalled()
    expect(game.setPlayerIdentity).toHaveBeenLastCalledWith(expect.objectContaining({
      username: null,
      character: expect.objectContaining({ id: 'lucas' }),
      companion: null,
    }))
    wrapper.unmount()
  })
})
