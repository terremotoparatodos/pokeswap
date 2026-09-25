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

function deps(calls: { fn: string; args: Record<string, unknown> }[] = [], secret: string | undefined = SECRET): AuthorityDeps {
  return { secret, rpc: async (fn, args) => { calls.push({ fn, args }); return { data: fn === 'world_owns_pokemon' ? true : { ok: 1 }, error: null } } }
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

  it('only knows four operations, each one fixed SQL function', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    expect((await handleWorldAuthority(post({ op: 'player_state', userId: USER }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'owns_pokemon', userId: USER, instanceId: 68 }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'load_nodes' }), deps(calls))).status).toBe(200)
    expect((await handleWorldAuthority(post({ op: 'update_table', table: 'profiles' }), deps(calls))).status).toBe(400)
    expect(calls.map(call => call.fn)).toEqual(['world_player_state', 'world_owns_pokemon', 'world_load_nodes'])
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
    expect(calls[0].fn).toBe('world_commit_work')
  })

  it('does not leak database errors to the caller', async () => {
    const failing: AuthorityDeps = { secret: SECRET, rpc: async () => ({ data: null, error: { message: 'relation "x" violates y on host db.internal' } }) }
    const response = await handleWorldAuthority(post({ op: 'load_nodes' }), failing)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('db.internal')
  })
})
