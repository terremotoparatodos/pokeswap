// CAVES-4: the "Ciudad" button and its free teleport are gone for good. Fast
// travel will be a separate feature; until then nothing in the shipped source
// may offer, emit or call a trip to the town that is not its portal.

import { describe, expect, it } from 'vitest'

// Every .ts and .vue under src/, as text (the same scan caves.guard.test.ts uses).
// Keys are paths relative to this folder (`./LobbyHud.vue`, `../engine/game.ts`).
const SOURCES = import.meta.glob<string>('../../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })
const files = Object.entries(SOURCES)
  .filter(([path]) => !/\.test\.ts$/.test(path))
  .map(([path, text]) => ({ path, text }))
const file = (suffix: string) => files.find(f => f.path.endsWith(suffix))

describe('no "Ciudad" teleport in the shipped client (CAVES-4)', () => {
  it('scans the real source tree', () => {
    expect(files.length).toBeGreaterThan(300)
    expect(file('/engine/game.ts')).toBeDefined()
    expect(file('/LobbyHud.vue')).toBeDefined()
    expect(file('/WildlandsView.vue')).toBeDefined()
  })

  it('no production file defines or calls a recall, or listens for the old button', () => {
    const offenders = files.filter(f => /returnToLobby|@home\b|emit\('home'\)|wl-home/.test(f.text)).map(f => f.path)
    expect(offenders).toEqual([])
  })

  it('the town is only requested by the travel callback (a walked portal) and the safe-point resync', () => {
    const game = file('/engine/game.ts')!.text
    expect(game).not.toMatch(/travelTo\(LOBBY_ID\)/)
    expect(game.match(/requestPresencePlacement\(/g)?.length).toBe(3) // definition, travel callback, safe point
  })
})
