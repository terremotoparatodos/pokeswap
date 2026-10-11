import test from 'node:test'
import assert from 'node:assert/strict'
import { limitedRelease } from './limitedRelease.js'
import { worldDependencies } from '../world/worldConfig.js'

// SCRIPTED configuration only: these .invalid hosts cannot establish real authority.
export const config = () => ({
  NODE_ENV: 'production', WORLD_ECO_RELEASE: 'limited', WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned',
  WORLD_ECO_TESTER_IDS: '11111111-1111-4111-8111-111111111111', WORLD_ECO_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
  ALLOWED_ORIGINS: 'https://eco-scripted.invalid', SUPABASE_URL: 'https://auth-scripted.invalid', SUPABASE_PUBLISHABLE_KEY: 'SCRIPTED-publishable',
  WORLD_AUTHORITY_URL: 'https://edge-scripted.invalid', WORLD_AUTHORITY_SECRET: 'SCRIPTED-test-only-not-a-secret-'.repeat(2), WORLD_LOCATION_PERSISTENCE: 'off',
})

test('normal production stays excluded even when the legacy ECO flag is on', () => {
  assert.equal(limitedRelease({ NODE_ENV: 'production' }), null)
  assert.equal(worldDependencies({ NODE_ENV: 'production' }).ecoExperiment, false)
  assert.throws(() => worldDependencies({ NODE_ENV: 'production', WORLD_ECO_EXPERIMENT: 'on' }), /development-only/)
  assert.throws(() => worldDependencies({ NODE_ENV: 'production', WORLD_ECO_COMBATANT_MODE: 'owned' }))
  assert.equal(worldDependencies(config()).ecoCombatantMode, 'owned')
})

test('limited configuration has no permissive defaults or silent typo fallbacks', () => {
  for (const name of ['NODE_ENV', 'WORLD_ECO_EXPERIMENT', 'WORLD_ECO_COMBATANT_MODE', 'WORLD_ECO_TESTER_IDS', 'WORLD_ECO_EXPIRES_AT', 'ALLOWED_ORIGINS', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'WORLD_AUTHORITY_URL', 'WORLD_AUTHORITY_SECRET']) {
    const env = config(); delete env[name]
    assert.throws(() => limitedRelease(env), new RegExp(name))
  }
  for (const [name, value] of [['WORLD_ECO_RELEASE', 'typo'], ['WORLD_ECO_COMBATANT_MODE', 'synthetic'], ['NODE_ENV', 'development'],
    ['WORLD_ECO_TESTER_IDS', 'benchmark-one'], ['WORLD_ECO_TESTER_IDS', `${config().WORLD_ECO_TESTER_IDS},`],
    ['WORLD_ECO_EXPIRES_AT', '2020-01-01T00:00:00Z'], ['WORLD_ECO_EXPIRES_AT', '2099-02-31T00:00:00Z'],
    ['WORLD_LOCATION_PERSISTENCE', 'shadow'], ['WORLD_LOCATION_PERSISTENCE', 'on'], ['ALLOWED_ORIGINS', 'https://pokeswap.lol'],
    ['ALLOWED_ORIGINS', 'https://www.pokeswap.lol'], ['ALLOWED_ORIGINS', 'http://localhost:5173'], ['ALLOWED_ORIGINS', 'https://eco-scripted.invalid/path'],
    ['ALLOWED_ORIGINS', 'https://eco-scripted.invalid,typo'], ['SUPABASE_URL', 'http://auth-scripted.invalid'],
    ['PRESENCE_BENCHMARK', 'on'], ['WORLD_PLAYERDATA', 'pglite'], ['WORLD_DEMO_SKILLS', 'on'], ['WORLD_WILD_CATALOG', 'synthetic']]) {
    assert.throws(() => limitedRelease({ ...config(), [name]: value }), new RegExp(name))
  }
})
