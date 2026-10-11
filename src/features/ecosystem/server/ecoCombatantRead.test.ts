import { describe, expect, it } from 'vitest'
import { readEcoCombatants, type EcoReadStore, type EcoSlotRow } from '../../../../supabase/functions/world-authority/ecoCombatantRead'
import { handleWorldAuthority, type AuthorityDeps } from '../../../../supabase/functions/world-authority/handler'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const secret = 'test-only-server-boundary'.repeat(2)
const slot = (owner = A, locked = false): EcoSlotRow => ({ pokemon_id: 25, owner_id: owner, is_locked: locked, first_owner_id: A, owned_since: null })
const post = (body: unknown, header = secret) => new Request('http://local.test/world-authority', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-world-authority-secret': header }, body: JSON.stringify(body),
})

describe('ECO authoritative read, isolated adapters only', () => {
  it('reads current owner progression and finishes with a fresh ownership/lock read', async () => {
    const calls: string[] = []
    let count = 0
    const store: EcoReadStore = {
      slots: async (user, id) => { expect([user, id]).toEqual([A, 25]); calls.push('slot'); return [slot(A, count++ > 0)] },
      progressions: async (user, ids) => {
        expect([user, ids]).toEqual([A, [25]]); calls.push('xp')
        return [A, B].map((user_id, index) => ({ user_id, pokemon_id: 25, xp: index ? 999999 : 1728, level: 12, moves: { 0: 'thunder-shock' } }))
      },
    }
    const rows = await readEcoCombatants(store, A, 25)
    expect(calls).toEqual(['slot', 'xp', 'slot'])
    expect(rows[0]?.slot.is_locked).toBe(true)
    expect(rows[0]?.progression?.xp).toBe(1728)
    expect(rows[0]?.progression?.user_id).toBe(A)
  })

  it('does not keep a sold slot or borrow ex-owner progression; empty reads do not fetch XP', async () => {
    let count = 0
    let xpCalls = 0
    const store: EcoReadStore = {
      slots: async () => [slot(count++ ? B : A)],
      progressions: async () => { xpCalls++; return [{ user_id: B, pokemon_id: 25, xp: 1, level: 1, moves: null }] },
    }
    expect(await readEcoCombatants(store, A, 25)).toEqual([])
    expect(xpCalls).toBe(1)
    expect(await readEcoCombatants(store, A, 25)).toEqual([])
    expect(xpCalls).toBe(1)
    const list = await readEcoCombatants({ ...store, slots: async () => [slot()] }, A, null)
    expect(list[0]?.progression).toBeNull()
  })

  it('fails closed before reading when secret, identity, shape or gate is invalid', async () => {
    let reads = 0
    const deps: AuthorityDeps = { secret, rpc: async () => ({ data: 'tester', error: null }), ecoCombatants: async () => { reads++; return [] } }
    expect((await handleWorldAuthority(post({ op: 'eco_combatants', userId: A }, 'wrong'), deps)).status).toBe(401)
    for (const body of [{ userId: 'benchmark-a' }, { userId: A, slotPokemonId: -1 }, { userId: A, moves: [] }]) {
      expect((await handleWorldAuthority(post({ op: 'eco_combatants', ...body }), deps)).status).toBe(400)
    }
    for (const gate of ['closed', null, 'unknown']) {
      expect((await handleWorldAuthority(post({ op: 'eco_combatants', userId: A }), { ...deps, rpc: async () => ({ data: gate, error: null }) })).status).toBe(403)
    }
    expect(reads).toBe(0)
    expect((await handleWorldAuthority(post({ op: 'eco_combatants', userId: A, slotPokemonId: 25 }), deps)).status).toBe(200)
    expect(reads).toBe(1)
  })

  it('missing adapter and read failure return an explicit refusal without leaking internals', async () => {
    const deps: AuthorityDeps = { secret, rpc: async () => ({ data: 'open', error: null }) }
    expect((await handleWorldAuthority(post({ op: 'eco_combatants', userId: A }), deps)).status).toBe(503)
    const response = await handleWorldAuthority(post({ op: 'eco_combatants', userId: A }), { ...deps, ecoCombatants: async () => { throw new Error('private-db-detail') } })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private-db-detail')
  })
})
