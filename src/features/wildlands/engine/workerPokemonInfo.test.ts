// WORLD VISUAL-1 review: a worker drawn before the Pokédex loads must not
// poison the shared Pokémon info cache (names, wilds, plaza, companions).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({ withSheet: new Set<number>(), overworld: 0 }))

vi.mock('./characters', async importOriginal => ({
  ...(await importOriginal<typeof import('./characters')>()),
  loadOverworldFrames: vi.fn(async (id: number) => {
    sheets.overworld++
    if (!sheets.withSheet.has(id)) throw new Error('no overworld sheet')
    return { up: [], down: [], left: [], right: [], sheetOf: id }
  }),
  loadFrontFrames: vi.fn(async (url: string) => ({ up: [], down: [], left: [], right: [], frontOf: url })),
}))

const { loadPokemonInfo, loadWorkerPokemonInfo } = await import('./population')

describe('worker info before the Pokédex loads', () => {
  beforeEach(() => { sheets.withSheet = new Set([152]); sheets.overworld = 0 })

  it('draws the bundled sheet with a placeholder name, then the real entry wins everywhere', async () => {
    const provisional = await loadWorkerPokemonInfo([], 152)
    expect(provisional).toMatchObject({ id: 152, name: '152', frames: { sheetOf: 152 } })

    const real = { id: 152, name_es: 'Chikorita', sprite_url: null }
    // Any other consumer (wilds, plaza, companions) asking for the species now.
    expect(await loadPokemonInfo(real, false)).toMatchObject({ id: 152, name: 'Chikorita', frames: { sheetOf: 152 } })
    // And the worker itself, once the Pokédex is there.
    expect(await loadWorkerPokemonInfo([real], 152)).toMatchObject({ name: 'Chikorita' })
  })

  it('a species without an overworld sheet does not leave a cached null behind', async () => {
    expect(await loadWorkerPokemonInfo([], 9_001)).toBeNull()
    const real = { id: 9_001, name_es: 'Sin hoja', sprite_url: 'https://example.invalid/9001.png' }
    expect(await loadPokemonInfo(real, false)).toMatchObject({ id: 9_001, name: 'Sin hoja', frames: { frontOf: real.sprite_url } })
  })

  it('the provisional info is never cached: each early request asks for the sheet again', async () => {
    await loadWorkerPokemonInfo([], 153)
    await loadWorkerPokemonInfo([], 153)
    expect(sheets.overworld).toBe(2)
  })
})
