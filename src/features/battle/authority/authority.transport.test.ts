// A whole authoritative battle, over the transport boundary (R32.4).
//
// This is the file the human gate reads. It does the thing R32.4 exists to do:
// a client sends an intention, the server validates it, runs Shared Battle
// Rules, and answers with events and a snapshot — and then the client sends
// the very same thing again and nothing happens twice.
//
// Every test here goes in through `room.message` with an `unknown` payload.
// None of them builds a `BattleCommand`, reaches into the state or calls the
// reducer: if a guarantee cannot be observed from the socket, it is not a
// guarantee a client has.

import { describe, expect, it } from 'vitest'
import { actionPayload, createAuthorityHarness } from './harness'
import type { AuthorityHarness } from './harness'
import type { AuthorityEventEnvelope, AuthoritySubmitResult } from './protocol'

/** Pikachu, and a wall that will not end the fight before a test is done. */
const DUEL = {
  party: [{ speciesId: 25, level: 50, moves: ['thunderbolt', 'quick-attack', 'double-slap'] }],
  wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
}

const harnessWithBench = () => createAuthorityHarness({
  party: [
    { speciesId: 25, level: 50, moves: ['thunderbolt', 'quick-attack'] },
    { speciesId: 6, level: 50, moves: ['flamethrower'] },
  ],
  wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
})

const send = (harness: AuthorityHarness, payload: unknown): AuthoritySubmitResult =>
  harness.room.message(harness.sessionId, 'expedition:action', payload)

const useMove = (harness: AuthorityHarness, actionId: string, slug: string, overrides = {}) =>
  send(harness, actionPayload(harness, actionId, {
    kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId(slug),
  }, overrides))

/** Runs the server loop until something is emitted, or the budget is spent. */
function run(harness: AuthorityHarness, steps: number, stepMs = 250): AuthorityEventEnvelope[] {
  const events: AuthorityEventEnvelope[] = []
  for (let step = 0; step < steps; step += 1) {
    harness.clock.advance(stepMs)
    events.push(...harness.room.update().events)
  }
  return events
}

const hpOf = (harness: AuthorityHarness, id: string): number => {
  const view = harness.authority.snapshot().combatants[id]
  return view.condition.currentHp ?? view.stats.hp
}

const ppOf = (harness: AuthorityHarness, id: string, moveId: number): number | undefined =>
  harness.authority.snapshot().combatants[id].condition.pp[moveId]

describe('an authoritative battle, end to end', () => {
  it('accepts an intention, runs it server-side and answers with truth', async () => {
    const harness = await createAuthorityHarness(DUEL)

    // The battle exists before anybody asks for anything, and it starts at
    // revision zero: nothing has happened yet.
    expect(harness.authority.revision()).toBe(0)
    expect(harness.authority.controls()).toEqual({ 'controller-a': ['ally-0'] })

    const accepted = useMove(harness, 'controller-a:1', 'thunderbolt')
    expect(accepted.kind).toBe('accepted')
    if (accepted.kind !== 'accepted') return

    expect(accepted.actionId).toBe('controller-a:1')
    expect(accepted.revision).toBe(1)
    expect(harness.authority.revision()).toBe(1)
    // The selection is truth now, and it came back in the snapshot rather than
    // being something the client has to assume.
    expect(accepted.snapshot.combatants['ally-0'].runtime.selected)
      .toEqual({ kind: 'move', moveId: harness.moveId('thunderbolt') })

    // Nothing has *resolved* yet: the Action Bar is the server's clock, and no
    // server time has passed.
    const events = run(harness, 40)
    const used = events.filter(e => e.event.type === 'MOVE_USED' && e.event.combatantId === 'ally-0')
    expect(used.length).toBeGreaterThan(0)
    expect(events.some(e => e.event.type === 'DAMAGE')).toBe(true)
    expect(hpOf(harness, 'wild-0')).toBeLessThan(harness.authority.snapshot().combatants['wild-0'].stats.hp)
  })

  it('stamps every event with the action that caused it, or with none', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const accepted = useMove(harness, 'controller-a:1', 'thunderbolt')
    if (accepted.kind !== 'accepted') throw new Error('expected an accepted action')

    // The command's own events carry the action id...
    expect(accepted.events.every(envelope => envelope.actionId === 'controller-a:1')).toBe(true)
    // ...and the clock's carry none, because no client asked for them.
    const ticked = run(harness, 40)
    expect(ticked.length).toBeGreaterThan(0)
    expect(ticked.every(envelope => envelope.actionId === null)).toBe(true)

    const all = [...accepted.events, ...ticked]
    expect(all.map(e => e.sequence)).toEqual(all.map((_, index) => index + 1))
    expect(all.every(e => e.battleId === harness.battleId)).toBe(true)
    // A revision never goes backwards over the stream.
    expect([...all].sort((a, b) => a.sequence - b.sequence).map(e => e.revision))
      .toEqual(all.map(e => e.revision).sort((a, b) => a - b))
  })

  it('does not run the same action twice, whatever it cost the first time', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const thunderbolt = harness.moveId('thunderbolt')

    const first = useMove(harness, 'controller-a:1', 'thunderbolt')
    if (first.kind !== 'accepted') throw new Error('expected an accepted action')
    // Let it actually resolve, so the duplicate arrives after PP was spent and
    // damage was dealt. A retry that only re-selects proves nothing.
    run(harness, 40)

    const revisionBefore = harness.authority.revision()
    const hpBefore = hpOf(harness, 'wild-0')
    const ppBefore = ppOf(harness, 'ally-0', thunderbolt)
    expect(ppBefore).toBeDefined()
    const internalBefore = harness.authority.internal().state

    const repeat = useMove(harness, 'controller-a:1', 'thunderbolt')
    expect(repeat.kind).toBe('duplicate')
    if (repeat.kind !== 'duplicate') return

    // The remembered answer, not a new one.
    expect(repeat.actionId).toBe('controller-a:1')
    expect(repeat.revision).toBe(first.revision)
    expect(repeat.events).toEqual(first.events)

    // And nothing moved: not the revision, not the HP, not the PP — and not
    // the state object itself, which is the strongest form of "nothing".
    expect(harness.authority.revision()).toBe(revisionBefore)
    expect(hpOf(harness, 'wild-0')).toBe(hpBefore)
    expect(ppOf(harness, 'ally-0', thunderbolt)).toBe(ppBefore)
    expect(harness.authority.internal().state).toBe(internalBefore)
  })

  it('leaves a battle where retries happened identical to one where they did not', async () => {
    // The property behind §9, stated once: a flaky link changes latency, and
    // nothing else. Two servers, same seed, same clock steps, same actions —
    // one of them receives every action three times.
    const script: readonly (readonly [string, string])[] = [
      ['controller-a:1', 'thunderbolt'],
      ['controller-a:2', 'quick-attack'],
      ['controller-a:3', 'double-slap'],
    ]

    const play = async (repeats: number) => {
      const harness = await createAuthorityHarness(DUEL)
      for (const [actionId, slug] of script) {
        for (let attempt = 0; attempt < repeats; attempt += 1) useMove(harness, actionId, slug)
        run(harness, 20)
      }
      return harness
    }

    const clean = await play(1)
    const flaky = await play(3)

    expect(flaky.authority.revision()).toBe(clean.authority.revision())
    expect(flaky.authority.internal().state).toEqual(clean.authority.internal().state)
    expect(flaky.authority.snapshot()).toEqual(clean.authority.snapshot())
  })

  it('refuses an action the client already superseded', async () => {
    const harness = await createAuthorityHarness(DUEL)
    useMove(harness, 'controller-a:1', 'thunderbolt')
    useMove(harness, 'controller-a:5', 'quick-attack')

    // Sequence 3 was never seen, but 5 was accepted: this is a message that
    // took the scenic route, and obeying it would undo a later decision.
    const late = useMove(harness, 'controller-a:3', 'double-slap')
    expect(late.kind).toBe('rejected')
    if (late.kind !== 'rejected') return
    expect(late.reason).toBe('STALE_ACTION')
    expect(late.revision).toBe(harness.authority.revision())
    expect(harness.authority.snapshot().combatants['ally-0'].runtime.selected)
      .toEqual({ kind: 'move', moveId: harness.moveId('quick-attack') })
  })

  it('tells a reconnecting client where to resume counting', async () => {
    const harness = await createAuthorityHarness(DUEL)
    expect(harness.authority.acceptedFloor('controller-a')).toBe(0)

    useMove(harness, 'controller-a:1', 'thunderbolt')
    useMove(harness, 'controller-a:2', 'quick-attack')
    expect(harness.authority.acceptedFloor('controller-a')).toBe(2)
    expect(harness.authority.acceptedFloor('controller-b')).toBe(0)

    // The reconnect: a new socket, the same controller. Counting from one
    // again is refused — as a duplicate while the ledger still holds it, as
    // stale once it does not — and either way it does not execute. So the
    // handshake hands the client the floor and it continues from there.
    harness.room.join({ sessionId: 'session-a2', controllerId: 'controller-a' })
    const revision = harness.authority.revision()
    const fresh = harness.room.message('session-a2', 'expedition:action', actionPayload(
      harness, 'controller-a:1', { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt') },
    ))
    expect(fresh.kind).not.toBe('accepted')
    expect(harness.authority.revision()).toBe(revision)

    const resumed = harness.room.message('session-a2', 'expedition:action', actionPayload(
      harness,
      `controller-a:${harness.authority.acceptedFloor('controller-a') + 1}`,
      { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt') },
    ))
    expect(resumed.kind).toBe('accepted')
  })

  it('carries a switch and an item through the same boundary', async () => {
    const harness = await harnessWithBench()

    const switched = send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'switch', combatantId: 'ally-0', incomingId: 'ally-1',
    }))
    expect(switched.kind).toBe('accepted')
    const events = run(harness, 24)
    expect(events.some(e => e.event.type === 'SWITCHED')).toBe(true)
    expect(harness.authority.snapshot().sides[0].activeIds).toEqual(['ally-1'])

    // An item is named, never described: the server owns what a Potion does.
    const item = send(harness, actionPayload(harness, 'controller-a:2', {
      kind: 'useItem', combatantId: 'ally-1', targetId: 'ally-1', item: { itemId: 'potion' },
    }))
    expect(item).toMatchObject({ kind: 'accepted' })
    if (item.kind !== 'accepted') return
    expect(item.snapshot.combatants['ally-1'].runtime.selected)
      .toEqual({ kind: 'item', item: { kind: 'healHp', amount: 20 }, targetId: 'ally-1' })
  })

  it('rejects without moving the canonical revision', async () => {
    const harness = await createAuthorityHarness(DUEL)
    useMove(harness, 'controller-a:1', 'thunderbolt')
    const revision = harness.authority.revision()

    // A move this Pikachu does not know: well formed, authorised, and refused
    // by the rules themselves.
    const refused = useMove(harness, 'controller-a:2', 'surf')
    expect(refused.kind).toBe('rejected')
    if (refused.kind !== 'rejected') return
    expect(refused.reason).toBe('ACTION_NOT_ALLOWED')
    expect(harness.authority.revision()).toBe(revision)

    // A rejection is not remembered, so correcting it and retrying works.
    const retry = useMove(harness, 'controller-a:3', 'quick-attack')
    expect(retry.kind).toBe('accepted')
  })

  it('serialises every payload it sends as plain JSON', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const accepted = useMove(harness, 'controller-a:1', 'thunderbolt')
    if (accepted.kind !== 'accepted') throw new Error('expected an accepted action')
    run(harness, 20)

    const round = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
    expect(round(accepted.snapshot)).toEqual(accepted.snapshot)
    expect(round(accepted.events)).toEqual(accepted.events)
    expect(round(harness.authority.snapshot())).toEqual(harness.authority.snapshot())
  })
})
