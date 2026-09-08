// Pokédex authority tests (R13).
// Verifies that all pokedex_entries writes go through server RPCs and that
// no direct table INSERT/UPDATE is ever called from the client.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../shared/api/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { supabase } from '../../../shared/api/supabase'
import {
  loadPokedexEntries,
  recordPokemonSeen,
  bulkRecordPokemonSeen,
  registerPokemon,
} from './pokedexApi'

const mockRpc  = supabase.rpc  as ReturnType<typeof vi.fn>
const mockFrom = supabase.from as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

// ── loadPokedexEntries ────────────────────────────────────────────────────────

describe('loadPokedexEntries', () => {
  it('SELECTs from pokedex_entries filtered by user_id', async () => {
    const selectMock = { eq: vi.fn().mockResolvedValue({ data: [], error: null }) }
    const fromMock   = { select: vi.fn().mockReturnValue(selectMock) }
    mockFrom.mockReturnValue(fromMock)

    await loadPokedexEntries('user-123')

    expect(mockFrom).toHaveBeenCalledWith('pokedex_entries')
    expect(fromMock.select).toHaveBeenCalledWith('pokemon_id, registered_at')
    expect(selectMock.eq).toHaveBeenCalledWith('user_id', 'user-123')
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns entries mapped with user_id attached', async () => {
    const rows = [
      { pokemon_id: 1, registered_at: '2026-09-08T00:00:00Z' },
      { pokemon_id: 2, registered_at: null },
    ]
    const selectMock = { eq: vi.fn().mockResolvedValue({ data: rows, error: null }) }
    mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue(selectMock) })

    const result = await loadPokedexEntries('user-abc')

    expect(result).toEqual([
      { user_id: 'user-abc', pokemon_id: 1, registered_at: '2026-09-08T00:00:00Z' },
      { user_id: 'user-abc', pokemon_id: 2, registered_at: null },
    ])
  })

  it('propagates Supabase errors', async () => {
    const selectMock = { eq: vi.fn().mockResolvedValue({ data: null, error: new Error('network') }) }
    mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue(selectMock) })

    await expect(loadPokedexEntries('user-x')).rejects.toThrow('network')
  })
})

// ── recordPokemonSeen ─────────────────────────────────────────────────────────

describe('recordPokemonSeen', () => {
  it('calls record_pokemon_seen RPC, never pokedex_entries directly', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await recordPokemonSeen(25)

    expect(mockRpc).toHaveBeenCalledWith('record_pokemon_seen', { p_pokemon_id: 25 })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('propagates pokemon_not_found error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('pokemon_not_found') })

    await expect(recordPokemonSeen(9999)).rejects.toThrow('pokemon_not_found')
  })
})

// ── bulkRecordPokemonSeen ─────────────────────────────────────────────────────

describe('bulkRecordPokemonSeen', () => {
  it('calls bulk_record_pokemon_seen RPC with the full id array', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await bulkRecordPokemonSeen([1, 4, 7, 25, 133])

    expect(mockRpc).toHaveBeenCalledWith('bulk_record_pokemon_seen', {
      p_pokemon_ids: [1, 4, 7, 25, 133],
    })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('is a no-op for an empty array', async () => {
    await bulkRecordPokemonSeen([])

    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('propagates RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('db_error') })

    await expect(bulkRecordPokemonSeen([1, 2])).rejects.toThrow('db_error')
  })
})

// ── registerPokemon ───────────────────────────────────────────────────────────

describe('registerPokemon', () => {
  it('calls register_pokemon RPC — registered_at set server-side', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await registerPokemon(6)

    expect(mockRpc).toHaveBeenCalledWith('register_pokemon', { p_pokemon_id: 6 })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('propagates pokemon_not_found error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('pokemon_not_found') })

    await expect(registerPokemon(9999)).rejects.toThrow('pokemon_not_found')
  })
})

// ── Integration scenario reminders (require real DB) ─────────────────────────
//
// PDX-INV-1: Direct client INSERT into pokedex_entries is rejected.
//   Action: authenticated client calls supabase.from('pokedex_entries').insert({...})
//   Expected: permission error after migration 009 is applied.
//
// PDX-INV-2: Direct client UPDATE on pokedex_entries is rejected.
//   Action: authenticated client calls supabase.from('pokedex_entries').update({registered_at: x})
//   Expected: permission error.
//
// PDX-INV-3: record_pokemon_seen with an invalid pokemon_id raises pokemon_not_found.
//
// PDX-INV-4: register_pokemon sets registered_at to the server's now(), not a client-supplied value.
//
// PDX-INV-5: bulk_record_pokemon_seen silently skips pokemon_ids not present in the pokemon table.
