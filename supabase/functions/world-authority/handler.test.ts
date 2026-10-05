// Run with: deno test supabase/functions/world-authority/
import { handleWorldAuthority, sameSecret, type AuthorityDeps } from './handler.ts'

function expect(actual: unknown) {
  const show = (v: unknown) => JSON.stringify(v)
  return {
    toBe(expected: unknown) { if (actual !== expected) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    toEqual(expected: unknown) { if (show(actual) !== show(expected)) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    not: { toContain(part: string) { if (String(actual).includes(part)) throw new Error(`did not expect ${part}`) } },
  }
}
const it = (name: string, fn: () => Promise<void>) => Deno.test(name, fn)
const describe = (_name: string, body: () => void) => body()

const SECRET = 'x'.repeat(48)
const USER = '11111111-1111-4111-8111-111111111111'

function deps(calls: { fn: string; args: Record<string, unknown> }[] = [], secret: string | undefined = SECRET, access: unknown = 'tester'): AuthorityDeps {
  const answer = (fn: string) => fn === 'world_owns_pokemon' ? true : fn === 'world_skills_access' ? access
    : fn === 'world_player_state' ? { xp: { woodcutting: 10 }, materials: {}, pokemon: [123] } : { ok: 1 }
  return { secret, rpc: async (fn, args) => { calls.push({ fn, args }); return { data: answer(fn), error: null } } }
}

const post = (body: unknown, secret: string | null = SECRET) => new Request('https://x/functions/v1/world-authority', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-world-authority-secret': secret }) }, body: JSON.stringify(body),
})

describe('world-authority Edge Function', () => {
  it('refuses anyone without the server secret, and never calls the database for them', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    for (const request of [post({ op: 'load_nodes' }, null), post({ op: 'load_nodes' }, 'wrong'), post({ op: 'load_nodes' }, SECRET + 'x')]) {
      expect((await handleWorldAuthority(request, deps(calls))).status).toBe(401)
    }
    expect(calls).toEqual([])
  })

  it('refuses to run with a missing or weak secret configured', async () => {
    expect((await handleWorldAuthority(post({ op: 'load_nodes' }, ''), deps([], undefined))).status).toBe(401)
    expect((await handleWorldAuthority(post({ op: 'load_nodes' }, 'short'), deps([], 'short'))).status).toBe(401)
    expect(sameSecret(SECRET, SECRET)).toBe(true)
  })

  it('the WORLD x SKILLS operations each map to one fixed SQL function; an unknown op is refused', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post({ op: 'access', userId: USER }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'player_state', userId: USER }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'owns_pokemon', userId: USER, instanceId: 68 }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'load_nodes' }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'update_table', table: 'profiles' }), deps(calls))).status).toBe(400)
    expect(calls.map(call => call.fn).sort()).toEqual(
      ['world_load_nodes', 'world_owns_pokemon', 'world_player_state', 'world_skills_access', 'world_skills_access', 'world_skills_access'])
  })

  it('feature gate: a closed user sees progress but owns no worker and cannot settle completed work', async () => {
    const good = {
      actionId: '00000000-0000-4000-8000-000000000002', userId: USER, skillId: 'mining', outcome: 'completed',
      xpGained: 10, rewards: [], levelBefore: 1, levelAfter: 1, rulesVersion: 'skills-1.0', node: null,
    }
    for (const closed of ['closed', null, 'OPEN', 42]) {
      const calls: { fn: string; args: Record<string, unknown> }[] = []
      const state = await (await handleWorldAuthority(post({ op: 'player_state', userId: USER }), deps(calls, SECRET, closed))).json()
      expect(state).toEqual({ state: { xp: { woodcutting: 10 }, materials: {}, pokemon: [] }, access: 'closed' })
      expect(await (await handleWorldAuthority(post({ op: 'owns_pokemon', userId: USER, instanceId: 123 }), deps(calls, SECRET, closed))).json()).toEqual({ owns: false })
      const refused = await handleWorldAuthority(post({ op: 'commit_work', commit: good }), deps(calls, SECRET, closed))
      expect(refused.status).toBe(403)
      expect(calls.some(call => call.fn === 'world_commit_work')).toBe(false)
      // Cancelling still settles (it pays nothing): an action cut by the gate is not stuck.
      expect((await handleWorldAuthority(post({ op: 'commit_work', commit: { ...good, outcome: 'cancelled', xpGained: 0 } }), deps(calls, SECRET, closed))).status).toBe(200)
    }
    for (const allowed of ['open', 'tester']) {
      const state = await (await handleWorldAuthority(post({ op: 'player_state', userId: USER }), deps([], SECRET, allowed))).json()
      expect(state.state.pokemon).toEqual([123])
      expect((await handleWorldAuthority(post({ op: 'commit_work', commit: good }), deps([], SECRET, allowed))).status).toBe(200)
    }
  })

  it('validates a commit before it reaches the database', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const good = {
      actionId: '00000000-0000-4000-8000-000000000001', userId: USER, skillId: 'woodcutting', outcome: 'completed',
      xpGained: 10, rewards: [], levelBefore: 1, levelAfter: 1, rulesVersion: 'skills-1.0', node: null,
    }
    for (const bad of [{ ...good, userId: 'me' }, { ...good, skillId: 'fishing' }, { ...good, actionId: 'x' }, { ...good, xpGained: 1.5 }, { ...good, outcome: 'won' }]) {
      expect((await handleWorldAuthority(post({ op: 'commit_work', commit: bad }), deps(calls))).status).toBe(400)
    }
    expect(calls).toEqual([])
    expect((await handleWorldAuthority(post({ op: 'commit_work', commit: good }), deps(calls))).status).toBe(200)
    expect(calls.map(call => call.fn)).toEqual(['world_skills_access', 'world_commit_work'])
  })

  it('does not leak database errors to the caller', async () => {
    const failing: AuthorityDeps = { secret: SECRET, rpc: async () => ({ data: null, error: { message: 'relation "x" violates y on host db.internal' } }) }
    const response = await handleWorldAuthority(post({ op: 'load_nodes' }), failing)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('db.internal')
  })
})

// ── WORLD LOCATION-2 ───────────────────────────────────────────────────────

const OTHER = '22222222-2222-4222-8222-222222222222'
const locationRow = (extra: Record<string, unknown> = {}) =>
  ({ userId: USER, epoch: 3, seq: 7, areaId: 'pradera', tx: -5, ty: -69, layoutVersion: 'p.0123456789ab', ...extra })

describe('world-authority location operations', () => {
  it('location_claim: needs the secret, a UUID and an expected epoch >= 0, calls exactly world_location_claim, no access gate', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post({ op: 'location_claim', userId: USER, expectedEpoch: 0 }, null), deps(calls))).status).toBe(401)
    for (const userId of ['me', 42, null, `${USER}x`]) {
      expect((await handleWorldAuthority(post({ op: 'location_claim', userId, expectedEpoch: 0 }), deps(calls))).status).toBe(400)
    }
    // The claim is conditional (review B2): without a well-formed expectation it never reaches SQL.
    for (const expectedEpoch of [undefined, null, -1, 1.5, '3', 2 ** 53, Number.NaN]) {
      expect((await handleWorldAuthority(post({ op: 'location_claim', userId: USER, expectedEpoch }), deps(calls))).status).toBe(400)
    }
    expect(calls).toEqual([])
    const ok = await handleWorldAuthority(post({ op: 'location_claim', userId: USER, expectedEpoch: 4, areaId: 'pradera', epoch: 99 }), deps(calls, SECRET, 'closed'))
    expect(ok.status).toBe(200)
    // A closed WORLD x SKILLS user still claims: a location is not a value. Extra fields never reach SQL.
    expect(calls).toEqual([{ fn: 'world_location_claim', args: { p_user_id: USER, p_expected_epoch: 4 } }])
  })

  it('location_save: rows are rebuilt field by field and passed whole to world_location_save', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const response = await handleWorldAuthority(post({ op: 'location_save', rows: [locationRow({ dir: 'up', admin: true }), locationRow({ userId: OTHER })] }), deps(calls))
    expect(response.status).toBe(200)
    expect(calls).toEqual([{ fn: 'world_location_save', args: { p_rows: [locationRow(), locationRow({ userId: OTHER })] } }])
  })

  it('location_save: one malformed row refuses the whole batch before the database', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const bad = [
      { userId: 'me' }, { epoch: 0 }, { epoch: 1.5 }, { epoch: '3' }, { seq: 0 }, { seq: 2 ** 53 }, { tx: 4096 }, { ty: -4097 }, { tx: 0.5 },
      { areaId: 'Pradera' }, { areaId: 'dg:cave:1' }, { areaId: 'ab' }, { layoutVersion: 'UPPER' }, { layoutVersion: '' }, { layoutVersion: 'x'.repeat(33) },
    ]
    for (const extra of bad) {
      expect((await handleWorldAuthority(post({ op: 'location_save', rows: [locationRow({ userId: OTHER }), locationRow(extra)] }), deps(calls))).status).toBe(400)
    }
    for (const rows of [[], 'rows', null, [locationRow(), locationRow({ seq: 8 })], [locationRow(), locationRow({ userId: USER.toUpperCase() })], Array.from({ length: 201 }, () => locationRow())]) {
      expect((await handleWorldAuthority(post({ op: 'location_save', rows }), deps(calls))).status).toBe(400)
    }
    expect(calls).toEqual([])
  })

  it('location_save: 200 rows is the limit, and accepted', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const rows = Array.from({ length: 200 }, (_, i) => locationRow({ userId: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}` }))
    expect((await handleWorldAuthority(post({ op: 'location_save', rows }), deps(calls))).status).toBe(200)
    expect(calls.length).toBe(1)
  })

  it('location operations do not leak database errors either', async () => {
    const failing: AuthorityDeps = { secret: SECRET, rpc: async () => ({ data: null, error: { message: 'world_player_locations on db.internal' } }) }
    for (const body of [{ op: 'location_claim', userId: USER, expectedEpoch: 0 }, { op: 'location_save', rows: [locationRow()] }]) {
      const response = await handleWorldAuthority(post(body), failing)
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('db.internal')
    }
  })
})

// ── WORLD LOCATION-4 (additive v5): host lifecycle and keyed location operations ──

const HOST = 'a0000000-0000-4000-8000-000000000001'
const SESSION = 'c0000000-0000-4000-8000-000000000001'
const keyed = (extra: Record<string, unknown> = {}) => ({ op: 'location_claim', userId: USER, generation: 4, seq: 9, sessionId: SESSION, hostId: HOST, ...extra })

describe('world-authority host lifecycle (presence_*)', () => {
  it('each presence op needs the secret and a well-formed host, and calls exactly its function', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post({ op: 'presence_acquire', hostId: HOST, leaseMs: 15000 }, null), deps(calls))).status).toBe(401)
    const ok = [
      [{ op: 'presence_acquire', hostId: HOST, leaseMs: 15000 }, { fn: 'world_presence_acquire', args: { p_host_id: HOST, p_lease_ms: 15000 } }],
      [{ op: 'presence_activate', generation: 4, hostId: HOST, leaseMs: 15000 }, { fn: 'world_presence_activate', args: { p_generation: 4, p_host_id: HOST, p_lease_ms: 15000 } }],
      [{ op: 'presence_renew', generation: 4, hostId: HOST, leaseMs: 15000 }, { fn: 'world_presence_renew', args: { p_generation: 4, p_host_id: HOST, p_lease_ms: 15000 } }],
      [{ op: 'presence_drain', generation: 4, hostId: HOST, drainMs: 10000 }, { fn: 'world_presence_drain', args: { p_generation: 4, p_host_id: HOST, p_drain_ms: 10000 } }],
      [{ op: 'presence_stop', generation: 4, hostId: HOST }, { fn: 'world_presence_stop', args: { p_generation: 4, p_host_id: HOST } }],
    ] as const
    for (const [body, call] of ok) {
      const before = calls.length
      expect((await handleWorldAuthority(post({ ...body, state: 'active', userId: USER }), deps(calls))).status).toBe(200)
      // Extra fields (a forged state, a user) never reach SQL.
      expect(calls.slice(before)).toEqual([call])
    }
  })

  it('a malformed host, lease or drain window is refused before the database', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const bad = [
      { op: 'presence_acquire', hostId: 'h1', leaseMs: 15000 }, { op: 'presence_acquire', hostId: HOST, leaseMs: 999 },
      { op: 'presence_acquire', hostId: HOST, leaseMs: 120001 }, { op: 'presence_acquire', hostId: HOST },
      { op: 'presence_activate', generation: 0, hostId: HOST, leaseMs: 15000 }, { op: 'presence_activate', generation: 1.5, hostId: HOST, leaseMs: 15000 },
      { op: 'presence_activate', generation: '4', hostId: HOST, leaseMs: 15000 }, { op: 'presence_activate', generation: 4, leaseMs: 15000 },
      { op: 'presence_renew', generation: 4, hostId: HOST, leaseMs: 'x' }, { op: 'presence_renew', generation: 2 ** 53, hostId: HOST, leaseMs: 15000 },
      { op: 'presence_drain', generation: 4, hostId: HOST, drainMs: 60001 }, { op: 'presence_drain', generation: 4, hostId: HOST },
      { op: 'presence_stop', generation: 4, hostId: `${HOST}x` },
    ]
    for (const body of bad) expect((await handleWorldAuthority(post(body), deps(calls))).status).toBe(400)
    expect(calls).toEqual([])
  })
})

describe('world-authority keyed location operations', () => {
  it('location_claim (keyed): the whole key and host are required, and passed as is to world_location_claim_keyed', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const response = await handleWorldAuthority(post(keyed({ areaId: 'pradera', epoch: 99, tabId: 'forged' })), deps(calls, SECRET, 'closed'))
    expect(response.status).toBe(200)
    expect(calls).toEqual([{ fn: 'world_location_claim_keyed', args: { p_user_id: USER, p_generation: 4, p_seq: 9, p_session: SESSION, p_host_id: HOST } }])
  })

  it('location_claim (keyed): any missing or malformed key field, or a mixed v1/v5 body, never reaches SQL', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const bad = [
      keyed({ userId: 'me' }), keyed({ generation: 0 }), keyed({ generation: undefined }), keyed({ seq: 0 }), keyed({ seq: 1.5 }),
      keyed({ seq: '9' }), keyed({ sessionId: 'tab-1' }), keyed({ sessionId: null }), keyed({ hostId: 'h' }),
      keyed({ expectedEpoch: 3 }), keyed({ expectedEpoch: 0 }),
      { op: 'location_claim', userId: USER, expectedEpoch: 0, hostId: HOST }, { op: 'location_claim', userId: USER, expectedEpoch: 0, seq: 1 },
    ]
    for (const body of bad) expect((await handleWorldAuthority(post(body), deps(calls))).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('location_save (keyed): the writing host travels with the rows; rows are validated exactly as in v1', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const ok = await handleWorldAuthority(post({ op: 'location_save', generation: 4, hostId: HOST, rows: [locationRow({ dir: 'up' })] }), deps(calls))
    expect(ok.status).toBe(200)
    expect(calls).toEqual([{ fn: 'world_location_save_keyed', args: { p_rows: [locationRow()], p_generation: 4, p_host_id: HOST } }])
    for (const body of [
      { op: 'location_save', generation: 4, rows: [locationRow()] }, { op: 'location_save', hostId: HOST, rows: [locationRow()] },
      { op: 'location_save', generation: 0, hostId: HOST, rows: [locationRow()] }, { op: 'location_save', generation: 4, hostId: HOST, rows: [locationRow({ tx: 4096 })] },
      { op: 'location_save', generation: 4, hostId: HOST, rows: [] },
    ]) expect((await handleWorldAuthority(post(body), deps(calls))).status).toBe(400)
    expect(calls.length).toBe(1)
  })

  it('the v1 shapes are unchanged (old realtime builds keep working until v1 is retired)', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post({ op: 'location_claim', userId: USER, expectedEpoch: 2 }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'location_save', rows: [locationRow()] }), deps(calls))).status).toBe(200)
    expect(calls.map(c => c.fn)).toEqual(['world_location_claim', 'world_location_save'])
  })

  it('keyed and presence operations do not leak database errors', async () => {
    const failing: AuthorityDeps = { secret: SECRET, rpc: async () => ({ data: null, error: { message: 'world_presence_hosts on db.internal' } }) }
    for (const body of [keyed(), { op: 'location_save', generation: 4, hostId: HOST, rows: [locationRow()] }, { op: 'presence_acquire', hostId: HOST, leaseMs: 15000 }, { op: 'presence_renew', generation: 4, hostId: HOST, leaseMs: 15000 }]) {
      const response = await handleWorldAuthority(post(body), failing)
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('db.internal')
    }
  })
})

// ── CLOUD READINESS-3 (additive v6): capabilities and presence-recovery operations ──

const claimV2 = (extra: Record<string, unknown> = {}) => ({ op: 'location_claim_v2', userId: USER, generation: 4, seq: 9, sessionId: SESSION, hostId: HOST, takeover: false, ...extra })
const missing = (code: string): AuthorityDeps => ({ secret: SECRET, rpc: async () => ({ data: null, error: { message: 'function public.x does not exist on db.internal', code } }) })
const answering = (data: unknown, calls: { fn: string; args: Record<string, unknown> }[] = []): AuthorityDeps =>
  ({ secret: SECRET, rpc: async (fn, args) => { calls.push({ fn, args }); return { data, error: null } } })

describe('world-authority v6: capabilities', () => {
  it('needs the secret; reflects the SQL actually there (the marker function), never this function\'s version', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post({ op: 'capabilities' }, null), answering(1, calls))).status).toBe(401)
    expect(calls).toEqual([])
    const ok = await handleWorldAuthority(post({ op: 'capabilities' }), answering(1, calls))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ recovery: { version: 1 } })
    expect(calls).toEqual([{ fn: 'world_presence_recovery_version', args: {} }])
    expect(await (await handleWorldAuthority(post({ op: 'capabilities' }), answering(2))).json()).toEqual({ recovery: null })
    for (const code of ['PGRST202', '42883']) {
      const absent = await handleWorldAuthority(post({ op: 'capabilities' }), missing(code))
      expect(absent.status).toBe(200)
      expect(await absent.json()).toEqual({ recovery: null })
    }
  })

  it('any other database failure is the usual 500, without leaking the database message', async () => {
    const response = await handleWorldAuthority(post({ op: 'capabilities' }), missing('57014'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('db.internal')
  })
})

describe('world-authority v6: presence-recovery operations', () => {
  it('location_claim_v2: the whole key, the host and an explicit boolean takeover go to world_location_claim_keyed_v2, nothing else', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    for (const takeover of [false, true]) {
      const response = await handleWorldAuthority(post(claimV2({ takeover, areaId: 'pradera', tabId: 'forged', epoch: 99 })), answering({ status: 'claimed' }, calls))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ claim: { status: 'claimed' } })
    }
    expect(calls).toEqual([false, true].map(takeover => ({ fn: 'world_location_claim_keyed_v2', args: { p_user_id: USER, p_generation: 4, p_seq: 9, p_session: SESSION, p_host_id: HOST, p_takeover: takeover } })))
  })

  it('location_claim_v2: a malformed key, a missing or non-boolean takeover, or a v1 field never reaches SQL', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const bad = [
      claimV2({ userId: 'me' }), claimV2({ generation: 0 }), claimV2({ seq: 1.5 }), claimV2({ sessionId: 'tab-1' }), claimV2({ hostId: 'h' }),
      claimV2({ takeover: undefined }), claimV2({ takeover: 'true' }), claimV2({ takeover: 1 }), claimV2({ expectedEpoch: 0 }),
    ]
    for (const body of bad) expect((await handleWorldAuthority(post(body), answering({ status: 'claimed' }, calls))).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('the original location_claim is not the v2 one: a takeover field on it never reaches SQL', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post(keyed({ takeover: true })), deps(calls))).status).toBe(200)
    expect(calls).toEqual([{ fn: 'world_location_claim_keyed', args: { p_user_id: USER, p_generation: 4, p_seq: 9, p_session: SESSION, p_host_id: HOST } }])
  })

  it('presence_activate_exclusive and presence_any_active call exactly their functions; malformed input is refused first', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post({ op: 'presence_activate_exclusive', generation: 4, hostId: HOST, leaseMs: 15000, state: 'active' }), answering({ status: 'candidate_starting' }, calls))).status).toBe(200)
    const any = await handleWorldAuthority(post({ op: 'presence_any_active' }), answering(true, calls))
    expect(await any.json()).toEqual({ active: true })
    expect(await (await handleWorldAuthority(post({ op: 'presence_any_active' }), answering('yes'))).json()).toEqual({ active: false })
    expect(calls).toEqual([
      { fn: 'world_presence_activate_exclusive', args: { p_generation: 4, p_host_id: HOST, p_lease_ms: 15000 } },
      { fn: 'world_presence_any_active', args: {} },
    ])
    for (const body of [{ op: 'presence_activate_exclusive', generation: 0, hostId: HOST, leaseMs: 15000 }, { op: 'presence_activate_exclusive', generation: 4, hostId: HOST, leaseMs: 999 }, { op: 'presence_activate_exclusive', generation: 4, leaseMs: 15000 }]) {
      expect((await handleWorldAuthority(post(body), answering({}))).status).toBe(400)
    }
  })

  it('a recovery op whose SQL function is missing answers 501 unsupported; any other failure stays 500', async () => {
    for (const body of [claimV2(), { op: 'presence_activate_exclusive', generation: 4, hostId: HOST, leaseMs: 15000 }, { op: 'presence_any_active' }]) {
      for (const code of ['PGRST202', '42883']) {
        const response = await handleWorldAuthority(post(body), missing(code))
        expect(response.status).toBe(501)
        expect(await response.json()).toEqual({ error: 'unsupported' })
      }
      const failed = await handleWorldAuthority(post(body), missing('57014'))
      expect(failed.status).toBe(500)
      expect(await failed.text()).not.toContain('db.internal')
    }
  })

  it('v5 ops keep their exact contract: a missing function there is still a 500, never 501; unknown ops are still 400 unknown_op', async () => {
    for (const body of [keyed(), { op: 'location_claim', userId: USER, expectedEpoch: 0 }, { op: 'presence_renew', generation: 4, hostId: HOST, leaseMs: 15000 }, { op: 'location_save', generation: 4, hostId: HOST, rows: [locationRow()] }]) {
      expect((await handleWorldAuthority(post(body), missing('PGRST202'))).status).toBe(500)
    }
    const unknown = await handleWorldAuthority(post({ op: 'location_claim_v3' }), deps())
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({ error: 'unknown_op' })
  })
})
