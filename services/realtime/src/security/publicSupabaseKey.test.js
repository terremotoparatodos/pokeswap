import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicSupabaseKey } from './publicSupabaseKey.js'
import { limitedRelease } from './limitedRelease.js'

// Fictitious public/privileged shapes, no real key or signature, no network.
const jwt = role => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ role, ref: 'SCRIPTED_NOT_REAL' })).toString('base64url'), 'SCRIPTED_FAKE_SIGNATURE'].join('.')
const privateShapes = ['sb_secret_' + 'A'.repeat(32), jwt('service_role')]
const publicShapes = ['sb_publishable_SCRIPTED_NOT_REAL', jwt('anon'), 'SCRIPTED-public-placeholder']
const configuration = key => ({ NODE_ENV: 'production', WORLD_ECO_RELEASE: 'limited', WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned',
  WORLD_ECO_TESTER_IDS: '11111111-1111-4111-8111-111111111111', WORLD_ECO_EXPIRES_AT: '2099-01-01T00:00:00Z', ALLOWED_ORIGINS: 'https://eco-scripted.invalid',
  SUPABASE_URL: 'https://auth-scripted.invalid', SUPABASE_PUBLISHABLE_KEY: key, WORLD_AUTHORITY_URL: 'https://edge-scripted.invalid', WORLD_AUTHORITY_SECRET: 'SCRIPTED-only-'.repeat(4) })

test('recognizable private content fails under any public field label without exposing its value', () => {
  for (const key of privateShapes) {
    for (const field of ['PUBLIC_KEY', 'ANON', 'PUBLISHABLE']) {
      assert.throws(() => assertPublicSupabaseKey(`  ${key}\n`, field), error => {
        assert.equal(error.message, `Recognizable private Supabase key in public configuration: ${field}`)
        assert.ok(!String(error.stack).includes(key))
        assert.equal(error.cause, undefined)
        return true
      })
    }
  }
})
test('publishable, legacy anon and project SCRIPTED fixtures remain compatible', () => {
  for (const key of publicShapes) {
    assert.doesNotThrow(() => assertPublicSupabaseKey(key, 'PUBLIC_KEY'))
    assert.ok(limitedRelease(configuration(key)))
  }
  // Recognition cannot certify arbitrary/unknown strings as public credentials.
  for (const value of [undefined, '', 'arbitrary-unknown-content', 'header.not-json.signature']) assert.doesNotThrow(() => assertPublicSupabaseKey(value, 'PUBLIC_KEY'))
})
test('server public configuration rejects both private shapes even without a limited opt-in', () => {
  for (const key of privateShapes) {
    assert.throws(() => limitedRelease(configuration(key)), /public configuration: SUPABASE_PUBLISHABLE_KEY$/)
    assert.throws(() => limitedRelease({ SUPABASE_PUBLISHABLE_KEY: key }), /public configuration: SUPABASE_PUBLISHABLE_KEY$/)
  }
})
