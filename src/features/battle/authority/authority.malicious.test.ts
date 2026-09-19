// What a hostile client gets (R32.4).
//
// AGENTS §2 is the premise: the browser is untrusted. Someone can read our
// source — it ships to them — open a socket by hand and send whatever they
// like. So every test here sends something a well-behaved client never would,
// and asserts on the **code** that comes back and on the state that did not
// change.
//
// The two that matter most are the quiet ones at the bottom: a payload that
// carries its own damage, and a payload that carries its own seed. Neither is
// rejected — they are *ignored*, and the proof is that the answer is byte for
// byte the answer to the same payload without them. A whitelist cannot be
// forgotten to be applied (`validate.ts`).

import { describe, expect, it } from 'vitest'
import { actionPayload, createAuthorityHarness } from './harness'
import type { AuthorityHarness } from './harness'
import type { AuthoritySubmitResult, RejectionReason } from './protocol'

const DUEL = {
  party: [{ speciesId: 25, level: 50, moves: ['thunderbolt', 'quick-attack'] }],
  wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
}

const send = (harness: AuthorityHarness, payload: unknown): AuthoritySubmitResult =>
  harness.room.message(harness.sessionId, 'expedition:action', payload)

function expectRejected(result: AuthoritySubmitResult, reason: RejectionReason): void {
  expect(result.kind).toBe('rejected')
  if (result.kind !== 'rejected') return
  expect(result.reason).toBe(reason)
}

describe('a hostile client', () => {
  it('cannot act for a Pokémon it does not command', async () => {
    const harness = await createAuthorityHarness(DUEL)
    // The wild side has no controller at all, so nobody may move it.
    expectRejected(send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'wild-0', moveId: harness.moveId('tackle'),
    })), 'NOT_CONTROLLER')
    expect(harness.authority.revision()).toBe(0)
  })

  it('cannot act for another player', async () => {
    const harness = await createAuthorityHarness(DUEL)
    harness.room.join({ sessionId: 'session-b', controllerId: 'controller-b' })

    const stolen = harness.room.message('session-b', 'expedition:action', actionPayload(
      harness, 'controller-b:1', { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt') },
    ))
    expectRejected(stolen, 'NOT_CONTROLLER')
    expect(harness.authority.revision()).toBe(0)
  })

  it('cannot mint action ids in somebody else s namespace', async () => {
    const harness = await createAuthorityHarness(DUEL)
    harness.room.join({ sessionId: 'session-b', controllerId: 'controller-b' })

    // Poisoning another player's dedupe window would let B make A's next
    // genuine action look like a duplicate. The prefix is checked against the
    // authenticated controller, so it cannot be done.
    const spoofed = harness.room.message('session-b', 'expedition:action', actionPayload(
      harness, 'controller-a:1', { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt') },
    ))
    expectRejected(spoofed, 'NOT_CONTROLLER')

    const genuine = send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'),
    }))
    expect(genuine.kind).toBe('accepted')
  })

  it('is not in the room until the transport says it is', async () => {
    const harness = await createAuthorityHarness(DUEL)
    expectRejected(harness.room.message('session-nobody', 'expedition:action', actionPayload(
      harness, 'controller-a:1', { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt') },
    )), 'NOT_CONTROLLER')
  })

  it('cannot aim at something that is not there', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const thunderbolt = harness.moveId('thunderbolt')

    expectRejected(send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'ally-0', moveId: thunderbolt, targetId: 'wild-9',
    })), 'INVALID_TARGET')
    expectRejected(send(harness, actionPayload(harness, 'controller-a:2', {
      kind: 'capture', combatantId: 'ally-0', targetId: 'ghost-0', ballId: 'poke-ball',
    })), 'INVALID_TARGET')
    // Capturing your own Pokémon is not a capture; R35 reads ownership here.
    expectRejected(send(harness, actionPayload(harness, 'controller-a:3', {
      kind: 'capture', combatantId: 'ally-0', targetId: 'ally-0', ballId: 'poke-ball',
    })), 'INVALID_TARGET')
    expect(harness.authority.revision()).toBe(0)
  })

  it('cannot use a move slot that does not exist', async () => {
    const harness = await createAuthorityHarness(DUEL)
    // Well formed and authorised: the rules are the ones that say no.
    expectRejected(send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'ally-0', moveId: 999_999,
    })), 'ACTION_NOT_ALLOWED')
    expect(harness.authority.revision()).toBe(0)
  })

  it('cannot smuggle a number the rules were never meant to see', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const bad = [-1, 0, 4.5, Number.NaN, Number.POSITIVE_INFINITY, 1e99, '25', null]
    bad.forEach((moveId, index) => {
      expectRejected(send(harness, actionPayload(harness, `controller-a:${index + 1}`, {
        kind: 'useMove', combatantId: 'ally-0', moveId,
      })), 'INVALID_SCHEMA')
    })
    expect(harness.authority.revision()).toBe(0)
  })

  it('cannot invent what an item does', async () => {
    const harness = await createAuthorityHarness(DUEL)
    // The R32.3 command carries an effect; the wire carries an id. A client
    // that describes a potion healing nine thousand is describing nothing.
    const accepted = send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useItem',
      combatantId: 'ally-0',
      targetId: 'ally-0',
      item: { itemId: 'potion', kind: 'healHp', amount: 9999 },
    }))
    expect(accepted.kind).toBe('accepted')
    if (accepted.kind !== 'accepted') return
    expect(accepted.snapshot.combatants['ally-0'].runtime.selected)
      .toEqual({ kind: 'item', item: { kind: 'healHp', amount: 20 }, targetId: 'ally-0' })

    expectRejected(send(harness, actionPayload(harness, 'controller-a:2', {
      kind: 'useItem', combatantId: 'ally-0', targetId: 'ally-0', item: { itemId: 'elixir-of-nine-thousand' },
    })), 'INVALID_SCHEMA')
  })

  it('cannot spell an action id its own way', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const intent = { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt') }
    const bad = ['', ':1', 'controller-a:', 'controller-a:0', 'controller-a:01', 'controller-a:-1',
      'controller-a:1.0', 'controller-a:1e3', 'a'.repeat(200) + ':1', 7, null, undefined, {}]
    for (const actionId of bad) {
      expectRejected(send(harness, { ...actionPayload(harness, 'x:1', intent), actionId }), 'INVALID_ACTION_ID')
    }
    expect(harness.authority.revision()).toBe(0)
  })

  it('cannot ask for a version this server does not run', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const intent = { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt') }

    expectRejected(send(harness, actionPayload(harness, 'controller-a:1', intent, {
      catalogVersion: '1.oras.deadbeefcafe',
    })), 'INVALID_VERSION')
    expectRejected(send(harness, actionPayload(harness, 'controller-a:2', intent, {
      battleRulesVersion: 'pokeswap-battle-v99',
    })), 'INVALID_VERSION')
    expectRejected(send(harness, actionPayload(harness, 'controller-a:3', intent, {
      battleId: 'some-other-battle',
    })), 'UNKNOWN_BATTLE')
    expect(harness.authority.revision()).toBe(0)
  })

  it('cannot send something that is not an action at all', async () => {
    const harness = await createAuthorityHarness(DUEL)
    expectRejected(send(harness, null), 'INVALID_SCHEMA')
    expectRejected(send(harness, 'thunderbolt'), 'INVALID_SCHEMA')
    expectRejected(send(harness, []), 'INVALID_SCHEMA')
    expectRejected(send(harness, actionPayload(harness, 'controller-a:1', { kind: 'useMove' })), 'INVALID_SCHEMA')
    // A message the room does not handle never reaches the authority.
    expectRejected(
      harness.room.message(harness.sessionId, 'expedition:give-me-a-shiny', {}),
      'UNKNOWN_ACTION',
    )
  })

  it('cannot ask for time to pass', async () => {
    const harness = await createAuthorityHarness(DUEL)
    // The clock is the server's, so there is no intent that could carry one.
    expectRejected(send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'advanceTime', combatantId: 'ally-0', deltaMs: 10_000,
    })), 'UNKNOWN_ACTION')
    expect(harness.authority.internal().state.timeMs).toBe(0)
  })

  it('cannot act once the battle is decided', async () => {
    const harness = await createAuthorityHarness({
      party: [{ speciesId: 25, level: 50, moves: ['thunderbolt'] }],
      wild: [{ speciesId: 129, level: 5, moves: ['splash'] }],
    })
    send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'),
    }))
    for (let step = 0; step < 40; step += 1) {
      harness.clock.advance(250)
      harness.room.update()
    }
    expect(harness.authority.snapshot().outcome.kind).toBe('decided')

    const revision = harness.authority.revision()
    expectRejected(send(harness, actionPayload(harness, 'controller-a:2', {
      kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'),
    })), 'BATTLE_FINISHED')
    expect(harness.authority.revision()).toBe(revision)
  })

  it('gets exactly the same answer whether or not it claims a result', async () => {
    // §7 in one assertion. The payload on the right carries damage, resulting
    // HP, a capture verdict, a seed, a cursor and a revision — every kind of
    // thing a client is not allowed to assert. Nothing reads any of it.
    const intent = (harness: AuthorityHarness) => ({
      kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'),
    })

    const honest = await createAuthorityHarness(DUEL)
    const liar = await createAuthorityHarness(DUEL)

    const plain = send(honest, actionPayload(honest, 'controller-a:1', intent(honest)))
    const loaded = send(liar, actionPayload(liar, 'controller-a:1', {
      ...intent(liar),
      damage: 9999,
      resultingHp: 1,
      critical: true,
      captured: true,
      rng: { seed: 1, cursor: 0 },
    }, {
      seed: 1,
      cursor: 0,
      revision: 500,
      serverTimeMs: 0,
      elapsedMs: 10_000,
      events: [{ type: 'CAPTURE_SUCCESS', targetId: 'wild-0' }],
    }))

    expect(loaded).toEqual(plain)
    expect(liar.authority.internal().state).toEqual(honest.authority.internal().state)
    // And the seed it tried to impose is not the seed the battle is running.
    expect(liar.authority.internal().state.rng.seed).not.toBe(1)
  })
})
