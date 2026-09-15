import test from 'node:test'
import assert from 'node:assert/strict'
import { ReconnectCache, RECONNECT_GRACE_MS } from './reconnectCache.js'

test('reconnect cache returns an actor only within its short ephemeral grace period', () => {
  const cache = new ReconnectCache()
  const actor = { id: 'trainer', tx: 12, ty: 8 }
  cache.remember(actor.id, actor, 1_000)
  assert.equal(cache.take(actor.id, 1_000 + RECONNECT_GRACE_MS - 1), actor)
})

test('reconnect cache expires instead of creating durable position state', () => {
  const cache = new ReconnectCache()
  cache.remember('trainer', { id: 'trainer' }, 1_000)
  assert.equal(cache.take('trainer', 1_000 + RECONNECT_GRACE_MS), null)
})
