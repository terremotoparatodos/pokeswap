// Whose clock it is (R32.4).
//
// R32.3's engine takes a delta and believes it. That is correct for a pure
// reducer and fatal on a socket, so the authority never takes one: it reads
// its own clock and subtracts. These tests move a fake clock by hand — nothing
// here sleeps, and nothing here is scheduled — and then try, in every way a
// client could, to make time pass without the server agreeing.

import { describe, expect, it } from 'vitest'
import { createManualClock, createSystemClock } from './clock'
import { actionPayload, createAuthorityHarness } from './harness'
import type { AuthorityHarness } from './harness'

/** Two Shuckle: four-second Action Bars and one damage a hit, so time is readable. */
const SLOW = {
  party: [{ speciesId: 213, level: 50, moves: ['tackle', 'toxic'] }],
  wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
}

const select = (harness: AuthorityHarness, actionId: string, slug: string) =>
  harness.room.message(harness.sessionId, 'expedition:action', actionPayload(harness, actionId, {
    kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId(slug),
  }))

const barOf = (harness: AuthorityHarness, id: string): number =>
  harness.authority.snapshot().combatants[id].runtime.actionElapsedMs

describe('the server clock', () => {
  it('advances the battle by exactly what the server clock moved', async () => {
    const harness = await createAuthorityHarness(SLOW)
    expect(harness.authority.internal().state.timeMs).toBe(0)

    harness.clock.advance(1000)
    harness.room.update()
    expect(harness.authority.internal().state.timeMs).toBe(1000)
    expect(barOf(harness, 'ally-0')).toBe(1000)
    expect(barOf(harness, 'wild-0')).toBe(1000)

    harness.clock.advance(1500)
    harness.room.update()
    expect(harness.authority.internal().state.timeMs).toBe(2500)
  })

  it('measures battle time from when the battle started, not from the epoch', async () => {
    // A wall clock reading is a huge number. Handing it to the rules as elapsed
    // milliseconds would finish every Action Bar in the game at once.
    const harness = await createAuthorityHarness({ ...SLOW, startAtMs: 1_763_000_000_000 })
    harness.clock.advance(800)
    harness.room.update()
    expect(harness.authority.internal().state.timeMs).toBe(800)
    expect(harness.authority.internal().startedAtMs).toBe(1_763_000_000_000)
    expect(harness.authority.snapshot().serverTimeMs).toBe(1_763_000_000_800)
  })

  it('ignores a client that says ten seconds went by', async () => {
    const harness = await createAuthorityHarness(SLOW)
    select(harness, 'controller-a:1', 'tackle')

    // Every shape of the lie at once: a delta, an elapsed, a timestamp, a
    // battle time. None of them is a field anything reads.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      harness.room.message(harness.sessionId, 'expedition:action', actionPayload(
        harness,
        `controller-a:${attempt + 2}`,
        { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('tackle'), deltaMs: 10_000 },
        { elapsedMs: 10_000, clientTimeMs: Date.now() + 999_999, timeMs: 10_000, serverTimeMs: 10_000 },
      ))
    }
    // The room loop ran too — it just has no time to hand out.
    harness.room.update()

    expect(harness.authority.internal().state.timeMs).toBe(0)
    expect(barOf(harness, 'ally-0')).toBe(0)
  })

  it('does not care how the server slices the same elapsed time', async () => {
    const play = async (stepMs: number, steps: number) => {
      const harness = await createAuthorityHarness(SLOW)
      select(harness, 'controller-a:1', 'tackle')
      for (let step = 0; step < steps; step += 1) {
        harness.clock.advance(stepMs)
        harness.room.update()
      }
      return harness
    }

    // Ten seconds as one step, as a 10 Hz server tick, and as 60 fps.
    const coarse = await play(10_000, 1)
    const server = await play(100, 100)
    const client = await play(16, 625)

    expect(server.authority.internal().state).toEqual(coarse.authority.internal().state)
    expect(client.authority.internal().state.timeMs).toBe(10_000)
    expect(client.authority.internal().state.combatants).toEqual(coarse.authority.internal().state.combatants)
  })

  it('runs a status on server time and on nothing else', async () => {
    const harness = await createAuthorityHarness(SLOW)
    select(harness, 'controller-a:1', 'toxic')

    const events = []
    for (let step = 0; step < 40; step += 1) {
      harness.clock.advance(500)
      events.push(...harness.room.update().events)
    }
    expect(events.some(e => e.event.type === 'STATUS_APPLIED')).toBe(true)
    const ticksAfterPoison = events.filter(e => e.event.type === 'STATUS_TICK').length
    expect(ticksAfterPoison).toBeGreaterThan(0)

    // Now the server clock stops. The client keeps talking; the poison does not
    // tick again, because a status tick is a server decision.
    const frozen = harness.authority.internal().state
    for (let attempt = 0; attempt < 50; attempt += 1) {
      harness.room.message(harness.sessionId, 'expedition:action', actionPayload(
        harness, `controller-a:${attempt + 2}`,
        { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('tackle') },
        { elapsedMs: 60_000 },
      ))
      harness.room.update()
    }
    expect(harness.authority.internal().state.timeMs).toBe(frozen.timeMs)
    expect(harness.authority.internal().state.combatants['wild-0'].condition.currentHp)
      .toBe(frozen.combatants['wild-0'].condition.currentHp)
  })

  it('emits nothing for a tick that found no time', async () => {
    const harness = await createAuthorityHarness(SLOW)
    expect(harness.room.update().events).toEqual([])
    harness.clock.advance(400)
    expect(harness.room.update().events.length).toBeGreaterThanOrEqual(0)
    const revision = harness.authority.revision()
    expect(harness.room.update().events).toEqual([])
    expect(harness.authority.revision()).toBe(revision)
  })
})

describe('the clocks themselves', () => {
  it('will not go backwards', () => {
    const clock = createManualClock(1000)
    expect(clock.nowMs()).toBe(1000)
    expect(clock.advance(250)).toBe(1250)
    expect(() => clock.advance(-1)).toThrow()
    expect(() => clock.setTo(1000)).toThrow()
    expect(clock.setTo(2000)).toBe(2000)
  })

  it('holds a system clock steady when the host steps back', () => {
    // A wall clock can jump when the host syncs. A frozen battle is
    // recoverable; one whose Action Bars rewind is not.
    let reading = 5_000
    const clock = createSystemClock(() => reading)
    expect(clock.nowMs()).toBe(5_000)
    reading = 4_000
    expect(clock.nowMs()).toBe(5_000)
    reading = 6_000
    expect(clock.nowMs()).toBe(6_000)
  })
})
