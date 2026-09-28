import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { RATE_LOG_WINDOW_MS, ResourceAuthority } from './resourceAuthority.js'
import { manualClock, praderaNodesNearSpawn, settle } from './testing.js'
import { WORK_RATE, WorkRateLimiter } from './workRateLimit.js'
import { WORK_TICK_MS } from './worldProtocol.js'

// SKILLS PROB-2: world:work is paced per player, server-side, on the server clock.

const [{ node: TREE, stands: [SPOT_A, SPOT_B] }] = praderaNodesNearSpawn()

test('the values: a burst of 4, then one intent every 500 ms (2/s)', () => {
  assert.deepEqual({ ...WORK_RATE }, { burst: 4, refillMs: 500 })
  const limiter = new WorkRateLimiter()
  const t0 = 1_000_000
  assert.deepEqual([1, 2, 3, 4, 5].map(() => limiter.take('p', t0)), [true, true, true, true, false])
  assert.equal(limiter.take('p', t0 + 499), false, 'not a whole token yet')
  assert.equal(limiter.take('p', t0 + 500), true)
  assert.equal(limiter.take('p', t0 + 500), false)
  // Idle long enough: back to the burst, never beyond it.
  const later = t0 + 60_000
  assert.deepEqual([1, 2, 3, 4, 5].map(() => limiter.take('p', later)), [true, true, true, true, false])
})

test('normal play is never limited: a first-tick success every 600 ms, forever', () => {
  const limiter = new WorkRateLimiter()
  let now = 5_000_000
  for (let i = 0; i < 1_000; i++, now += WORK_TICK_MS) assert.equal(limiter.take('fast', now), true, `request ${i}`)
})

test('normal play is never limited: a double tap and a retry after a refusal, every second', () => {
  const limiter = new WorkRateLimiter()
  let now = 7_000_000
  for (let second = 0; second < 300; second++, now += 1_000) {
    assert.equal(limiter.take('tapper', now), true)
    assert.equal(limiter.take('tapper', now + 10), true, 'the double tap')
  }
})

test('buckets are per player: one spammer does not slow anyone else', () => {
  const limiter = new WorkRateLimiter()
  for (let i = 0; i < 50; i++) limiter.take('spam', 0)
  assert.equal(limiter.take('spam', 0), false)
  assert.equal(limiter.take('honest', 0), true)
})

test('the tracked players stay bounded; idle buckets go first', () => {
  const limiter = new WorkRateLimiter({ maxTracked: 3 })
  limiter.take('busy', 0); limiter.take('busy', 0); limiter.take('busy', 0)
  for (const id of ['a', 'b', 'c', 'd', 'e']) limiter.take(id, 10_000)
  assert.ok(limiter.size <= 3)
})

function setup() {
  const clock = manualClock()
  const actors = new Map([['a', { id: 'a', areaId: 'pradera', ...SPOT_A }], ['b', { id: 'b', areaId: 'pradera', ...SPOT_B }]])
  const skills = createDemoSkillPolicy({ durationMs: WORK_TICK_MS })
  let reads = 0
  const base = createStaticOwnership({ a: [25], b: [6] })
  const ownership = { async verify(...args) { reads++; return base.verify(...args) } }
  const logs = []
  let ids = 0
  const authority = new ResourceAuthority({
    skills, ownership, lookupActor: id => actors.get(id) ?? null, now: clock.now, sleep: async () => {},
    newActionId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, log: line => logs.push(line),
  })
  return { authority, clock, actors, skills, logs, reads: () => reads }
}
const intent = (requestId, pokemonInstanceId = 25) => ({ nodeId: TREE.id, pokemonInstanceId, requestId })

test('spam: 50 intents at once — 4 reach the checks, 46 are refused for free, one action, one settlement', async () => {
  const { authority, clock, actors, skills, reads } = setup()
  const replies = await Promise.all(Array.from({ length: 50 }, (_, i) => authority.requestWork(actors.get('a'), intent(i + 1))))
  const reasons = replies.map(reply => (reply.ok ? 'ok' : reply.reason))
  assert.equal(reasons.filter(r => r === 'ok').length, 1)
  assert.equal(reasons.filter(r => r === 'rate-limited').length, 46)
  assert.deepEqual(reasons.slice(0, 4).sort(), ['in-flight', 'in-flight', 'in-flight', 'ok'])
  assert.equal(reads(), 1, 'one ownership read')
  assert.equal(skills.authorized.length, 1, 'one SKILLS authorization')
  assert.equal(authority.metrics.rateLimited, 46)
  assert.equal(authority.metrics.rejected['rate-limited'], 46)
  clock.advance(WORK_TICK_MS); authority.tick(); await settle()
  assert.equal(skills.grants, 1)
})

test('duplicates and races keep their own answers while tokens remain, and never settle twice', async () => {
  const { authority, clock, actors, skills } = setup()
  const [first, again] = await Promise.all([authority.requestWork(actors.get('a'), intent(7)), authority.requestWork(actors.get('a'), intent(7))])
  assert.equal(first.ok, true)
  assert.equal(again.reason, 'duplicate-request')
  const race = await authority.requestWork(actors.get('b'), intent(1, 6))
  assert.equal(race.reason, 'busy', 'the other player is not rate-limited, just too late')
  clock.advance(WORK_TICK_MS); authority.tick(); await settle()
  assert.equal(skills.grants, 1)
})

test('reconnecting does not refill the bucket; waiting does', async () => {
  const { authority, clock, actors } = setup()
  actors.get('a').tx += 5 // far away: every intent is refused cheaply after the limiter
  for (let i = 1; i <= 4; i++) assert.equal((await authority.requestWork(actors.get('a'), intent(i))).reason, 'too-far')
  authority.newConnection('a')
  assert.equal((await authority.requestWork(actors.get('a'), intent(1))).reason, 'rate-limited')
  clock.advance(500)
  assert.equal((await authority.requestWork(actors.get('a'), intent(2))).reason, 'too-far')
})

test('the log is bounded: the first refusal, then at most one line a minute with totals and no ids', async () => {
  const { authority, clock, actors, logs } = setup()
  actors.get('a').tx += 5
  for (let i = 1; i <= 30; i++) await authority.requestWork(actors.get('a'), intent(i))
  assert.equal(logs.length, 1)
  clock.advance(RATE_LOG_WINDOW_MS - 1)
  for (let i = 31; i <= 60; i++) await authority.requestWork(actors.get('a'), intent(i))
  assert.equal(logs.length, 1, 'still inside the window')
  clock.advance(1)
  await authority.requestWork(actors.get('a'), intent(61))
  await authority.requestWork(actors.get('a'), intent(62))
  await authority.requestWork(actors.get('a'), intent(63))
  await authority.requestWork(actors.get('a'), intent(64))
  await authority.requestWork(actors.get('a'), intent(65))
  assert.equal(logs.length, 2)
  assert.match(logs[1], /rate-limited \d+ work intent\(s\) from 1 player\(s\) in the last minute/)
  for (const line of logs) assert.doesNotMatch(line, /\ba\b|pradera|:\d+:/)
})
