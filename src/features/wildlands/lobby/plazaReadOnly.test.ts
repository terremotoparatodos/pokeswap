import { describe, expect, it } from 'vitest'

// R26 modules only read PokeSwap state (TRUST_BOUNDARY §2). This scans their
// sources for any Supabase write path, browser storage or raw HTML, so a future
// edit that adds one fails here and has to be discussed.
const SOURCES = import.meta.glob<string>(
  [
    './domain/ownedSlots.ts',
    './api/plazaApi.ts',
    './usePlazaRealtime.ts',
    './usePlazaData.ts',
    './plazaNotices.ts',
    '../engine/plazaPokemon.ts',
    '../engine/plazaTaps.ts',
    '../engine/pokeball.ts',
    '../engine/ownerMarker.ts',
    '../areas/townPopulace.ts',
    '../components/PlazaPokemonCard.vue',
    '../components/ActivityBoard.vue',
    '../components/PlazaNotice.vue',
    '../components/LobbyPlaza.vue',
  ],
  { query: '?raw', import: 'default', eager: true },
)

// Supabase query-builder writes (`Map#delete(key)` takes an argument, the builder's `.delete()` does not).
const WRITES = [
  /\.insert\s*\(/, /\.upsert\s*\(/, /\.update\s*\(\s*\{/, /\.delete\s*\(\s*\)/, /\.rpc\s*\(/, /functions\s*\.\s*invoke/,
  /localStorage|sessionStorage/, /innerHTML|v-html/,
]
/** The only R26 modules allowed to talk to Supabase at all: selects and Realtime. */
const SUPABASE_CLIENTS = new Set(['./api/plazaApi.ts', './usePlazaRealtime.ts'])

describe('R26 plaza modules are read-only', () => {
  it('finds every listed module', () => {
    expect(Object.keys(SOURCES)).toHaveLength(14)
  })

  it.each(Object.entries(SOURCES))('%s has no write path nor raw HTML', (path, source) => {
    for (const pattern of WRITES) expect(source, String(pattern)).not.toMatch(pattern)
    if (!SUPABASE_CLIENTS.has(path)) expect(source).not.toMatch(/shared\/api\/supabase/)
  })

  it('catches a write if one sneaks in', () => {
    const sample = "await supabase.from('slots').update({ owner_id: 'me' }).eq('pokemon_id', 1)"
    expect(WRITES.some(p => p.test(sample))).toBe(true)
    expect(WRITES.some(p => p.test('this.members.delete(id)'))).toBe(false)
  })
})
