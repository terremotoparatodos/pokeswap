import { describe, expect, it } from 'vitest'
import { isLobbyFeature, LOBBY_FEATURE_IDS, LOBBY_FEATURES, panelAccess } from './features'

describe('lobby features', () => {
  it('lists the six PokeSwap functions', () => {
    expect([...LOBBY_FEATURE_IDS].sort()).toEqual(['caja', 'dungeon', 'mercado', 'perfil', 'pokedex', 'swap'])
  })

  it("keeps Swap only as Silph Co.'s retired door: no menu entry, no session needed (SWAP RETIRE-2)", () => {
    expect(LOBBY_FEATURES.swap).toEqual({ title: 'Silph Co.', requiresAuth: false, inMenu: false })
    for (const id of LOBBY_FEATURE_IDS) if (id !== 'swap') expect(LOBBY_FEATURES[id].inMenu, id).toBe(true)
  })

  it('recognises feature ids only', () => {
    expect(isLobbyFeature('mercado')).toBe(true)
    expect(isLobbyFeature('lobby')).toBe(false)
    expect(isLobbyFeature('toString')).toBe(false)
    expect(isLobbyFeature(undefined)).toBe(false)
  })
})

describe('panelAccess', () => {
  const guest = { isLoading: false, signedIn: false }
  const restoring = { isLoading: true, signedIn: false }
  const member = { isLoading: false, signedIn: true }

  it('is closed without a feature', () => {
    expect(panelAccess(null, member)).toBe('closed')
  })

  it('lets guests browse the market', () => {
    expect(panelAccess('mercado', guest)).toBe('open')
  })

  it('asks guests to sign in for account features', () => {
    for (const id of ['dungeon', 'pokedex', 'perfil', 'caja'] as const) {
      expect(panelAccess(id, guest)).toBe('auth')
      expect(panelAccess(id, member)).toBe('open')
    }
  })

  it('waits while the session is being restored instead of flashing the sign-in modal', () => {
    expect(panelAccess('dungeon', restoring)).toBe('wait')
  })

  it('opens the retired Silph Co. notice for anyone, since it does nothing', () => {
    expect(panelAccess('swap', guest)).toBe('open')
    expect(panelAccess('swap', restoring)).toBe('open')
  })
})
