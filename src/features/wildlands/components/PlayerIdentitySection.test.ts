import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'
import { usePlayerPreferencesStore } from '../identity/playerPreferencesStore'
import PlayerIdentitySection from './PlayerIdentitySection.vue'

const pokemon = (id: number, locked: boolean): SlotWithPokemon => ({
  slot: { pokemon_id: id, owner_id: 'u1', is_locked: locked } as SlotWithPokemon['slot'],
  pokemon: { id, name_es: id === 25 ? 'Pikachu' : 'Eevee', sprite_url: null } as SlotWithPokemon['pokemon'],
})

describe('PlayerIdentitySection', () => {
  beforeEach(() => {
    localStorage.clear()
    usePlayerPreferencesStore().deactivate()
  })

  it('changes character and companion locally while disabling locked Pokémon', async () => {
    const wrapper = mount(PlayerIdentitySection, {
      props: { userId: 'u1', items: [pokemon(25, false), pokemon(133, true)], loading: false, error: null },
    })
    const characters = wrapper.findAll('.player-character')
    await characters[1].trigger('click')
    const companions = wrapper.findAll('.player-companion')
    await companions[1].trigger('click')
    expect(usePlayerPreferencesStore().preferences.value).toMatchObject({
      characterId: 'dawn-pink', companionPokemonId: 25,
    })
    expect(companions[2].attributes('disabled')).toBeDefined()
  })
})
