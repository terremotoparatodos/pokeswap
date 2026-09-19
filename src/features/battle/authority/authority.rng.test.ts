// Whose dice they are, and who may look at them (R32.4).
//
// Two separate claims, and the second is the one that would quietly ruin the
// game if it were wrong:
//
//   the server picks the seed, and a client cannot influence it;
//   the client never **sees** the seed or the cursor.
//
// `rngValueAt(seed, cursor)` is exported from the rules, deterministic and
// three lines long. Anyone holding those two numbers can read off the next
// accuracy check, the next critical and — the one that moves ownership — the
// next capture roll. They would not need to cheat. They would need to look.

import { describe, expect, it } from 'vitest'
import { rngValueAt } from '../rules'
import { actionPayload, createAuthorityHarness } from './harness'
import { createFixedSeedSource, createRuntimeSeedSource, createSequenceSeedSource } from './seed'
import { projectClientSnapshot } from './snapshot'

const DUEL = {
  party: [{ speciesId: 25, level: 50, moves: ['thunderbolt', 'quick-attack'] }],
  wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
}

const play = async (seed: number) => {
  const harness = await createAuthorityHarness({ ...DUEL, seed })
  harness.room.message(harness.sessionId, 'expedition:action', actionPayload(
    harness, 'controller-a:1',
    { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 'wild-0' },
  ))
  const events = []
  for (let step = 0; step < 24; step += 1) {
    harness.clock.advance(250)
    events.push(...harness.room.update().events.map(envelope => envelope.event))
  }
  return { harness, events }
}

/** Every key and every string anywhere in a value, however deep. */
function walk(value: unknown, onKey: (key: string) => void, seen = new Set<unknown>()): void {
  if (typeof value !== 'object' || value === null) return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) walk(item, onKey, seen)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    onKey(key)
    walk(child, onKey, seen)
  }
}

describe('the authoritative RNG', () => {
  it('is the server that picks the seed, once, at creation', async () => {
    const harness = await createAuthorityHarness({ ...DUEL, seed: 777 })
    expect(harness.authority.internal().state.rng).toEqual({ seed: 777, cursor: 0 })
  })

  it('gives the same battle back for the same seed, clock and actions', async () => {
    const first = await play(4242)
    const second = await play(4242)
    expect(second.events).toEqual(first.events)
    expect(second.harness.authority.internal().state).toEqual(first.harness.authority.internal().state)
    expect(second.harness.authority.revision()).toBe(first.harness.authority.revision())
  })

  it('gives a different battle for a different seed', async () => {
    const a = await play(4242)
    const b = await play(99_999)
    // Somewhere in a fight with accuracy, criticals and damage rolls, two
    // seeds have to disagree — otherwise the rolls are not being consumed.
    expect(b.harness.authority.internal().state.rng.cursor).toBeGreaterThan(0)
    expect(b.events).not.toEqual(a.events)
  })

  it('does not let a client touch the seed or the cursor', async () => {
    const harness = await createAuthorityHarness({ ...DUEL, seed: 4242 })
    const before = harness.authority.internal().state.rng

    harness.room.message(harness.sessionId, 'expedition:action', actionPayload(
      harness,
      'controller-a:1',
      {
        kind: 'useMove',
        combatantId: 'ally-0',
        moveId: harness.moveId('thunderbolt'),
        targetId: 'wild-0',
        rng: { seed: 1, cursor: 0 },
        seed: 1,
      },
      { rng: { seed: 1, cursor: 999 }, seed: 1, cursor: 999 },
    ))

    const after = harness.authority.internal().state.rng
    expect(after.seed).toBe(before.seed)
    // The cursor moves only because the rules drew, never because a client said so.
    expect(after.cursor).toBeGreaterThanOrEqual(before.cursor)
    expect(after.cursor).not.toBe(999)
  })

  it('never puts the seed or the cursor in a client snapshot', async () => {
    const { harness } = await play(4242)
    const snapshot = harness.authority.snapshot()
    const internal = harness.authority.internal().state

    // The state it was projected from does carry them: the leak would be real.
    expect(internal.rng.seed).toBe(4242)
    expect(internal.rng.cursor).toBeGreaterThan(0)

    const keys: string[] = []
    walk(snapshot, key => keys.push(key))
    expect(keys).not.toContain('rng')
    expect(keys).not.toContain('seed')
    expect(keys).not.toContain('cursor')

    // And not hiding in a value either: the seed as a number, anywhere.
    const wire = JSON.stringify(snapshot)
    expect(wire).not.toContain('"rng"')
    expect(wire).not.toContain(String(internal.rng.seed))
  })

  it('never puts them in an event envelope either', async () => {
    const harness = await createAuthorityHarness({ ...DUEL, seed: 4242 })
    const accepted = harness.room.message(harness.sessionId, 'expedition:action', actionPayload(
      harness, 'controller-a:1',
      { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 'wild-0' },
    ))
    const envelopes = [...(accepted.kind === 'accepted' ? accepted.events : [])]
    for (let step = 0; step < 24; step += 1) {
      harness.clock.advance(250)
      envelopes.push(...harness.room.update().events)
    }
    expect(envelopes.length).toBeGreaterThan(0)

    const keys: string[] = []
    walk(envelopes, key => keys.push(key))
    expect(keys).not.toContain('rng')
    expect(keys).not.toContain('seed')
    expect(keys).not.toContain('cursor')
  })

  it('leaves a client unable to predict the next roll from what it was sent', async () => {
    // The concrete attack, spelled out: with the seed and the cursor, the next
    // value is one call away. The snapshot gives a client neither, so there is
    // nothing to put into this function.
    const { harness } = await play(4242)
    const internal = harness.authority.internal().state
    const nextRoll = rngValueAt(internal.rng.seed, internal.rng.cursor)
    expect(nextRoll).toBeGreaterThanOrEqual(0)
    expect(nextRoll).toBeLessThan(1)

    const snapshot = harness.authority.snapshot() as unknown as Record<string, unknown>
    expect(snapshot.rng).toBeUndefined()
    expect(Object.keys(snapshot)).not.toContain('rng')
  })

  it('is a projection, so the rules keep their honest state', async () => {
    // §22's decision, asserted: R32.3 was not bent to satisfy transport. The
    // state still carries its RNG; the projection is what drops it.
    const { harness } = await play(4242)
    const state = harness.authority.internal().state
    const projected = projectClientSnapshot(state, { revision: 3, serverTimeMs: 12, controls: {} })
    expect(state.rng).toBeDefined()
    expect((projected as unknown as Record<string, unknown>).rng).toBeUndefined()
    expect(projected.revision).toBe(3)
  })
})

describe('the seed sources', () => {
  it('gives a test the same seed and a sequence the seeds it was given', () => {
    expect(createFixedSeedSource(7).createSeed()).toBe(7)
    const sequence = createSequenceSeedSource([1, 2])
    expect([sequence.createSeed(), sequence.createSeed(), sequence.createSeed()]).toEqual([1, 2, 2])
    expect(() => createSequenceSeedSource([])).toThrow()
  })

  it('draws a production seed from the runtime CSPRNG, never from Math.random', () => {
    const source = createRuntimeSeedSource()
    const seeds = new Set(Array.from({ length: 64 }, () => source.createSeed()))
    // A 32-bit CSPRNG repeating inside 64 draws would be a collision at odds
    // no test should ever see; a constant or a counter would fail here loudly.
    expect(seeds.size).toBeGreaterThan(60)
    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(0xffff_ffff)
    }
  })
})
