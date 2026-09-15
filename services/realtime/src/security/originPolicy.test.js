import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedOrigins, originPolicy } from './originPolicy.js'

test('development permits only local Vite origins by default', () => {
  const policy = originPolicy({ NODE_ENV: 'development' })
  assert.equal(policy(new Request('http://service', { headers: { origin: 'http://localhost:5173' } })), undefined)
  assert.equal(policy(new Request('http://service', { headers: { origin: 'https://attacker.example' } })).status, 403)
})

test('production permits only the official origins plus an explicit allowlist', () => {
  assert.equal(allowedOrigins({ NODE_ENV: 'production' }).size, 2)
  const defaultPolicy = originPolicy({ NODE_ENV: 'production' })
  assert.equal(defaultPolicy(new Request('https://service', { headers: { origin: 'https://pokeswap.lol' } })), undefined)
  assert.equal(defaultPolicy(new Request('https://service', { headers: { origin: 'https://attacker.example' } })).status, 403)
  const policy = originPolicy({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://pokeswap.lol, https://www.pokeswap.lol' })
  assert.equal(policy(new Request('https://service', { headers: { origin: 'https://pokeswap.lol' } })), undefined)
  assert.equal(policy(new Request('https://service', { headers: { origin: 'https://elsewhere.example' } })).status, 403)
})

test('configured origins tolerate display-only quotes and brackets', () => {
  const policy = originPolicy({
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: '["https://pokeswap.lol","https://www.pokeswap.lol"]',
  })
  assert.equal(policy(new Request('https://service', { headers: { origin: 'https://pokeswap.lol' } })), undefined)
  assert.equal(policy(new Request('https://service', { headers: { origin: 'https://attacker.example' } })).status, 403)
})
