import test from 'node:test'
import assert from 'node:assert/strict'
import { authenticateSupabase, authorizedCompanion } from './supabaseAuth.js'

const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-key' }

test('missing, invalid and incomplete JWTs are guests without leaking tokens', async () => {
  assert.deepEqual(await authenticateSupabase(null, env), { kind: 'guest' })
  const invalid = await authenticateSupabase('not-a-jwt', env, async () => new Response('', { status: 401 }))
  assert.deepEqual(invalid, { kind: 'guest' })
  const incomplete = await authenticateSupabase('token', env, async () => Response.json({ id: 'id', user_metadata: {} }))
  assert.deepEqual(incomplete, { kind: 'guest' })
})

test('auth uses the bearer token only for the one-time Supabase verification', async () => {
  let request
  const result = await authenticateSupabase('sensitive-token', env, async (url, init) => {
    request = { url, init }
    return Response.json({ id: 'user-1', user_metadata: { username: '<img src=x>' } })
  })
  assert.deepEqual(result, { kind: 'player', userId: 'user-1', username: '<img src=x>' })
  assert.match(request.url, /\/auth\/v1\/user$/)
  assert.equal(request.init.headers.authorization, 'Bearer sensitive-token')
})

test('companion must be an unlocked slot owned by the authenticated user', async () => {
  assert.equal(await authorizedCompanion('user-1', 25, 'token', env, async () => Response.json([{ pokemon_id: 25 }])), 25)
  assert.equal(await authorizedCompanion('user-1', 25, 'token', env, async () => Response.json([])), null)
  assert.equal(await authorizedCompanion('user-1', -1, 'token', env), null)
})
