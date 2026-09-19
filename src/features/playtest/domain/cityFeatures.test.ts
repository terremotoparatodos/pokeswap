import { describe, expect, it } from 'vitest'
import { LOBBY_FEATURE_IDS } from '../../wildlands/lobby/features'
import { CLOSED_HEADLINE, OPEN_FEATURES, isOpenDuringPlaytest, playtestSurfaceFor } from './cityFeatures'

describe('the city during the playtest', () => {
  it('opens the Centro Pokémon and the Tienda, and only those', () => {
    expect(OPEN_FEATURES).toEqual(['caja', 'mercado'])
    expect(playtestSurfaceFor('caja')).toEqual({ kind: 'centro' })
    expect(playtestSurfaceFor('mercado')).toEqual({ kind: 'tienda' })
  })

  it('answers for every door the city has, so none can fall through', () => {
    for (const feature of LOBBY_FEATURE_IDS) {
      const surface = playtestSurfaceFor(feature)
      expect(surface.kind, feature).toBeTruthy()
      if (surface.kind === 'closed') {
        expect(surface.title.length, feature).toBeGreaterThan(0)
        expect(surface.reason.length, feature).toBeGreaterThan(0)
      }
    }
  })

  it('closes the doors that touch real money, ownership or the economy', () => {
    for (const feature of ['swap', 'perfil', 'pokedex'] as const) {
      expect(playtestSurfaceFor(feature).kind, feature).toBe('closed')
      expect(isOpenDuringPlaytest(feature)).toBe(false)
    }
  })

  it('closes the Gimnasio and says where Dungeons actually are', () => {
    const gym = playtestSurfaceFor('dungeon')
    expect(gym.kind).toBe('closed')
    if (gym.kind === 'closed') expect(gym.reason).toMatch(/cueva/i)
  })

  it('never leaves a dead click: a closed door has a headline and a reason', () => {
    expect(CLOSED_HEADLINE).toMatch(/Community Playtest 0\.1/)
    const closed = LOBBY_FEATURE_IDS.map(playtestSurfaceFor).filter(surface => surface.kind === 'closed')
    expect(closed.length).toBe(LOBBY_FEATURE_IDS.length - OPEN_FEATURES.length)
  })
})
