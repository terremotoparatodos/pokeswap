import { beforeEach, describe, expect, it } from 'vitest'
import {
  defaultPlayerPreferences,
  playerPreferencesKey,
  readPlayerPreferences,
  removePlayerPreferences,
  writePlayerPreferences,
} from './playerPreferences'

describe('player preferences', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips cosmetic identity under a versioned per-user key', () => {
    const value = {
      version: 1 as const,
      characterId: 'dawn-pink' as const,
      companionPokemonId: 25,
      townPosition: { tx: 31, ty: 20, dir: 'left' as const },
    }
    expect(writePlayerPreferences('u1', value)).toBe(true)
    expect(localStorage.getItem(playerPreferencesKey('u2'))).toBeNull()
    expect(readPlayerPreferences('u1')).toEqual(value)
  })

  it('falls back and removes corrupt or unknown-version data', () => {
    localStorage.setItem(playerPreferencesKey('u1'), '{broken')
    expect(readPlayerPreferences('u1')).toEqual(defaultPlayerPreferences())
    expect(localStorage.getItem(playerPreferencesKey('u1'))).toBeNull()

    localStorage.setItem(playerPreferencesKey('u1'), JSON.stringify({ version: 2, characterId: 'lucas' }))
    expect(readPlayerPreferences('u1')).toEqual(defaultPlayerPreferences())
    expect(localStorage.getItem(playerPreferencesKey('u1'))).toBeNull()
  })

  it('drops invalid optional fields without losing a valid character', () => {
    localStorage.setItem(playerPreferencesKey('u1'), JSON.stringify({
      version: 1,
      characterId: 'dawn-yellow',
      companionPokemonId: -4,
      townPosition: { tx: 1.5, ty: 2, dir: 'sideways' },
    }))
    expect(readPlayerPreferences('u1')).toEqual({
      version: 1,
      characterId: 'dawn-yellow',
      companionPokemonId: null,
      townPosition: null,
    })
  })

  it('continues with defaults when browser storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(readPlayerPreferences('u1', unavailable)).toEqual(defaultPlayerPreferences())
    expect(writePlayerPreferences('u1', defaultPlayerPreferences(), unavailable)).toBe(false)
    expect(removePlayerPreferences('u1', unavailable)).toBe(false)
  })
})
