import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { Slot } from '../../../shared/types/database'

// ── Supabase mock: reads and Realtime only; any write fails the test ─────────
type Handler = (payload: Record<string, unknown>) => void
const channels = new Map<string, { handler?: Handler; status?: (s: string) => void }>()
const writes: string[] = []
const tables: Record<string, unknown[]> = { slots: [], activity_feed: [] }
let failSlots = false
let slotsGate: Promise<void> = Promise.resolve()

vi.mock('../../../shared/api/supabase', () => {
  const forbid = (name: string) => () => {
    writes.push(name)
    throw new Error(`write attempted: ${name}`)
  }
  const query = (table: string) => {
    const result = async () => {
      if (table === 'slots') {
        await slotsGate
        if (failSlots) return { data: null, error: new Error('offline') }
      }
      return { data: tables[table], error: null }
    }
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => result().then(ok, ko),
      insert: forbid(`${table}.insert`),
      update: forbid(`${table}.update`),
      upsert: forbid(`${table}.upsert`),
      delete: forbid(`${table}.delete`),
    }
    return builder
  }
  return {
    supabase: {
      from: (table: string) => query(table),
      rpc: forbid('rpc'),
      functions: { invoke: forbid('functions.invoke') },
      channel: (name: string) => {
        const entry: { handler?: Handler; status?: (s: string) => void } = {}
        channels.set(name, entry)
        const api = {
          on: (_t: string, _f: unknown, handler: Handler) => { entry.handler = handler; return api },
          subscribe: (status?: (s: string) => void) => { entry.status = status; return { name } },
        }
        return api
      },
      removeChannel: vi.fn(),
    },
  }
})

import { NOTICE_MS, PATCH_BATCH_MS, usePlazaData } from './usePlazaData'

function slot(id: number, price: number, owner: string | null, username: string | null = owner): Slot {
  return {
    pokemon_id: id, owner_id: owner, owner_username: username, current_price: price, claim_count: null,
    is_locked: false, last_claimed_at: null, aura: null, aura_updated_at: null, owned_since: null,
    first_owner_id: null, first_owner_username: null, energy: null, energy_updated_at: null,
    link_url: null, link_text: null, created_at: null, updated_at: null,
  }
}

const pokedex = ref([{ id: 25, name_es: 'Pikachu', type1: 'electric', type2: null, sprite_url: null }])
const userId = ref<string | null>('me')
const quiet = ref(false)

function host() {
  let api!: ReturnType<typeof usePlazaData>
  const wrapper = mount(defineComponent({
    setup() {
      api = usePlazaData({ pokedex, userId, quiet: () => quiet.value })
      return () => h('div')
    },
  }))
  return { wrapper, plaza: () => api }
}

/** The latest channel whose name starts with `prefix` (names carry a per-instance suffix). */
function channel(prefix: string) {
  const name = [...channels.keys()].reverse().find(n => n.startsWith(`${prefix}-`))
  return channels.get(name!)!
}

const slotEvent = (row: Record<string, unknown>) => channel('plaza-slots').handler!({ eventType: 'UPDATE', new: row })

beforeEach(() => {
  vi.useFakeTimers()
  channels.clear()
  writes.length = 0
  failSlots = false
  slotsGate = Promise.resolve()
  userId.value = 'me'
  quiet.value = false
  // 12 owned Pokémon: 1 is the cheapest; 25 (mine) is the most expensive.
  tables.slots = [...Array.from({ length: 11 }, (_, i) => slot(i + 1, (i + 1) * 100, 'other')), slot(25, 9999, 'me', 'yo')]
  tables.activity_feed = [{ id: 'a0', type: 'claim', user_id: 'x', pokemon_id: 25, created_at: null }]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePlazaData', () => {
  it('loads the top 10 by price and marks the viewer’s own', async () => {
    const { plaza } = host()
    await flushPromises()
    const residents = plaza().residents.value
    expect(residents.map(r => r.pokemonId)).toEqual([25, 11, 10, 9, 8, 7, 6, 5, 4, 3])
    expect(residents.filter(r => r.mine).map(r => r.pokemonId)).toEqual([25])
    expect(plaza().activity.value).toHaveLength(1)
    expect(plaza().loaded.value).toBe(true)
  })

  it('does not show the viewer’s cheaper Pokémon: the plaza is top-only', async () => {
    tables.slots = [...tables.slots, slot(30, 1, 'me')]
    const { plaza } = host()
    await flushPromises()
    expect(plaza().residents.value.some(r => r.pokemonId === 30)).toBe(false)
  })

  it('applies batched Realtime changes: Pokémon enter, leave and update their card', async () => {
    const { plaza } = host()
    await flushPromises()
    channel('plaza-slots').status!('SUBSCRIBED')
    slotEvent({ pokemon_id: 1, owner_id: 'buyer', owner_username: 'nuevo', current_price: 50_000 })
    slotEvent({ pokemon_id: 11, owner_id: 'other', owner_username: 'other', current_price: 2000 })
    expect(plaza().residents.value[0].pokemonId).toBe(25)
    vi.advanceTimersByTime(PATCH_BATCH_MS)
    const ids = plaza().residents.value.map(r => r.pokemonId)
    expect(ids[0]).toBe(1)
    expect(ids).not.toContain(3)
    expect(plaza().card(1)).toMatchObject({ name: '#1', ownerUsername: 'nuevo', price: 50_000, owned: true, mine: false })
    expect(plaza().card(11).price).toBe(2000)
  })

  it('announces when one of the viewer’s Pokémon changes owner', async () => {
    const { plaza } = host()
    await flushPromises()
    slotEvent({ pokemon_id: 25, owner_id: 'thief', owner_username: 'thief', current_price: 9999 })
    vi.advanceTimersByTime(PATCH_BATCH_MS)
    expect(plaza().notice.value).toBe('Pikachu ya no es tuyo: cambió de dueño')
    expect(plaza().card(25).mine).toBe(false)
    vi.advanceTimersByTime(NOTICE_MS)
    expect(plaza().notice.value).toBeNull()
  })

  it('toasts new activity grouped, and stays quiet while the town is covered', async () => {
    const { plaza } = host()
    await flushPromises()
    const activity = channel('plaza-activity').handler!
    activity({ new: { id: 'a1', type: 'claim', pokemon_id: 25 } })
    expect(plaza().notice.value).toBe('Captura · Pikachu')
    activity({ new: { id: 'a2', type: 'claim', pokemon_id: 7 } })
    activity({ new: { id: 'a3', type: 'free_claim', pokemon_id: 8 } })
    vi.advanceTimersByTime(NOTICE_MS)
    expect(plaza().notice.value).toBe('2 novedades en el tablón')
    vi.advanceTimersByTime(NOTICE_MS)
    expect(plaza().notice.value).toBeNull()

    quiet.value = true
    activity({ new: { id: 'a4', type: 'claim', pokemon_id: 25 } })
    expect(plaza().notice.value).toBeNull()
    expect(plaza().activity.value[0].id).toBe('a4')
  })

  it('replays changes that arrive while slots are loading on top of the fetched state', async () => {
    let open!: () => void
    slotsGate = new Promise(r => { open = r })
    const { plaza } = host()
    await vi.advanceTimersByTimeAsync(0)
    slotEvent({ pokemon_id: 2, owner_id: 'late', owner_username: 'late', current_price: 1e6 })
    open()
    await flushPromises()
    expect(plaza().residents.value[0].pokemonId).toBe(2)
    expect(plaza().notice.value).toBeNull()
  })

  it('reads the slots again after a reconnect', async () => {
    const { plaza } = host()
    await flushPromises()
    const status = channel('plaza-slots').status!
    status('SUBSCRIBED')
    tables.slots = [slot(40, 1, 'other')]
    status('TIMED_OUT')
    status('SUBSCRIBED')
    await flushPromises()
    expect(plaza().residents.value.map(r => r.pokemonId)).toEqual([40])
  })

  it('keeps the town usable when slots cannot be read', async () => {
    failSlots = true
    const { plaza } = host()
    await flushPromises()
    expect(plaza().loadError.value).toBe(true)
    expect(plaza().residents.value).toEqual([])
  })

  it('never writes to Supabase', async () => {
    const { plaza, wrapper } = host()
    await flushPromises()
    channel('plaza-slots').status!('SUBSCRIBED')
    slotEvent({ pokemon_id: 25, owner_id: 'x', owner_username: 'x', current_price: 1 })
    channel('plaza-activity').handler!({ new: { id: 'z', type: 'claim', pokemon_id: 25 } })
    await plaza().refresh()
    vi.advanceTimersByTime(NOTICE_MS * 3)
    wrapper.unmount()
    expect(writes).toEqual([])
  })
})
