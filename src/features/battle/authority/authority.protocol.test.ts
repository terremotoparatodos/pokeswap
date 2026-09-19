// The three protocol decisions R32.4 closes (A-1, A-3, A-4).
//
// Each of them is a promise about the **wire**, not about the engine, so each
// of them is asserted from outside: a payload goes in, an envelope comes out,
// and what the server kept to itself stays where it belongs.

import { describe, expect, it } from 'vitest'
import { actionPayload, createAuthorityHarness } from './harness'
import type { AuthorityHarness } from './harness'
import type { AuthoritySubmitResult, RejectionReason } from './protocol'

const DUEL = {
  party: [{ speciesId: 25, level: 50, moves: ['thunderbolt', 'quick-attack'] }],
  wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
}

/** Charizard knows Protect, which is the catalog's `target: user`. */
const WITH_SELF_MOVE = {
  party: [{ speciesId: 6, level: 50, moves: ['flamethrower', 'protect'] }],
  wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
}

const send = (harness: AuthorityHarness, payload: unknown): AuthoritySubmitResult =>
  harness.room.message(harness.sessionId, 'expedition:action', payload)

const move = (harness: AuthorityHarness, actionId: string, slug: string, targetId: string) =>
  send(harness, actionPayload(harness, actionId, {
    kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId(slug), targetId,
  }))

function expectRejected(result: AuthoritySubmitResult, reason: RejectionReason): void {
  expect(result.kind).toBe('rejected')
  if (result.kind !== 'rejected') return
  expect(result.reason).toBe(reason)
}

// ── A-1 ─────────────────────────────────────────────────────────────────────

describe('the reconnect sequence contract', () => {
  it('hands a joining controller everything it needs to start counting', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const ack = harness.authority.joinAck('controller-a')

    expect(ack).toEqual({
      battleId: harness.battleId,
      controllerId: 'controller-a',
      currentRevision: 0,
      nextActionSequence: 1,
      catalogVersion: harness.catalog.catalogVersion,
      battleRulesVersion: harness.authority.snapshot().battleRulesVersion,
      controlledCombatantIds: ['ally-0'],
    })
    // Transport-safe: it has to survive a websocket unchanged.
    expect(JSON.parse(JSON.stringify(ack))).toEqual(ack)
  })

  it('keeps the floor out of the snapshot, where it would not belong', async () => {
    const harness = await createAuthorityHarness(DUEL)
    move(harness, 'controller-a:1', 'thunderbolt', 'wild-0')

    // A snapshot describes the battle and goes to everyone. A sequence floor
    // describes one controller's own counter. A snapshot that differed per
    // viewer would not be a snapshot.
    const snapshot = harness.authority.snapshot() as unknown as Record<string, unknown>
    expect(Object.keys(snapshot)).not.toContain('acceptedFloor')
    expect(Object.keys(snapshot)).not.toContain('nextActionSequence')
    expect(JSON.stringify(snapshot)).not.toContain('nextActionSequence')
  })

  it('carries the way out on the one rejection a client cannot solve alone', async () => {
    const harness = await createAuthorityHarness(DUEL)
    move(harness, 'controller-a:1', 'thunderbolt', 'wild-0')
    move(harness, 'controller-a:7', 'quick-attack', 'wild-0')

    const stale = move(harness, 'controller-a:3', 'thunderbolt', 'wild-0')
    expect(stale.kind).toBe('rejected')
    if (stale.kind !== 'rejected') return
    expect(stale.reason).toBe('STALE_ACTION')
    // Without this a client would have to guess, and guessing high wastes the
    // dedupe window while guessing low keeps getting refused.
    expect(stale.nextActionSequence).toBe(8)
  })

  it('lets a reconnecting controller recover and act exactly once', async () => {
    const harness = await createAuthorityHarness(DUEL)

    // 1. It plays.
    expect(move(harness, 'controller-a:1', 'thunderbolt', 'wild-0').kind).toBe('accepted')
    expect(move(harness, 'controller-a:2', 'quick-attack', 'wild-0').kind).toBe('accepted')
    harness.clock.advance(3000)
    harness.room.update()

    // 2. The socket dies.
    harness.room.leave(harness.sessionId)
    expect(harness.room.participants()).toEqual([])

    // 3. It comes back on a new socket and is told where it stands.
    const ack = harness.room.join({ sessionId: 'session-a2', controllerId: 'controller-a' })
    expect(ack).not.toBeNull()
    if (!ack) return
    expect(ack.nextActionSequence).toBe(3)
    expect(ack.currentRevision).toBe(harness.authority.revision())

    // 4. It resumes from the sequence it was given, instead of from 1.
    const revisionBefore = harness.authority.revision()
    const resumed = harness.room.message('session-a2', 'expedition:action', actionPayload(
      harness,
      `controller-a:${ack.nextActionSequence}`,
      { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 'wild-0' },
    ))
    expect(resumed.kind).toBe('accepted')
    expect(harness.authority.revision()).toBe(revisionBefore + 1)

    // 5. And once. The in-flight copy the dead socket never acknowledged
    // arrives anyway, and is answered from the ledger.
    const revisionAfter = harness.authority.revision()
    const echo = harness.room.message('session-a2', 'expedition:action', actionPayload(
      harness,
      `controller-a:${ack.nextActionSequence}`,
      { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 'wild-0' },
    ))
    expect(echo.kind).toBe('duplicate')
    expect(harness.authority.revision()).toBe(revisionAfter)

    // The floor was never reset: the actions from before the drop are still
    // recognised, which is the whole reason not to reset it.
    const old = harness.room.message('session-a2', 'expedition:action', actionPayload(
      harness,
      'controller-a:1',
      { kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 'wild-0' },
    ))
    expect(old.kind).not.toBe('accepted')
    expect(harness.authority.revision()).toBe(revisionAfter)
  })
})

// ── A-3 ─────────────────────────────────────────────────────────────────────

describe('a move names its target, always', () => {
  it('refuses a command that leaves the target out', async () => {
    const harness = await createAuthorityHarness(DUEL)
    // There is exactly one opponent and the server still will not guess it.
    // Inferring here is what makes the command's shape depend on how many
    // combatants are on the field.
    expectRejected(send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'),
    })), 'INVALID_SCHEMA')
    expectRejected(send(harness, actionPayload(harness, 'controller-a:2', {
      kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: '',
    })), 'INVALID_SCHEMA')
    expectRejected(send(harness, actionPayload(harness, 'controller-a:3', {
      kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 42,
    })), 'INVALID_SCHEMA')
    expect(harness.authority.revision()).toBe(0)
  })

  it('accepts an offensive move aimed at the opponent', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const accepted = move(harness, 'controller-a:1', 'thunderbolt', 'wild-0')
    expect(accepted.kind).toBe('accepted')
    expect(harness.authority.revision()).toBe(1)
  })

  it('accepts a self-targeted move aimed at its own user', async () => {
    const harness = await createAuthorityHarness(WITH_SELF_MOVE)
    // Protect is `target: user` in the catalog, so naming yourself is right.
    const accepted = move(harness, 'controller-a:1', 'protect', 'ally-0')
    expect(accepted.kind).toBe('accepted')
    if (accepted.kind !== 'accepted') return
    expect(accepted.snapshot.combatants['ally-0'].runtime.selected)
      .toEqual({ kind: 'move', moveId: harness.moveId('protect') })
  })

  it('refuses an offensive move aimed at its own user', async () => {
    const harness = await createAuthorityHarness(WITH_SELF_MOVE)
    expectRejected(move(harness, 'controller-a:1', 'flamethrower', 'ally-0'), 'INVALID_TARGET')
    expect(harness.authority.revision()).toBe(0)
  })

  it('refuses a self-targeted move aimed at somebody else', async () => {
    const harness = await createAuthorityHarness(WITH_SELF_MOVE)
    expectRejected(move(harness, 'controller-a:1', 'protect', 'wild-0'), 'INVALID_TARGET')
    expect(harness.authority.revision()).toBe(0)
  })

  it('refuses a target that belongs to another battle', async () => {
    const one = await createAuthorityHarness({ ...DUEL, battleId: 'battle-one' })
    const two = await createAuthorityHarness({
      battleId: 'battle-two',
      party: [
        { speciesId: 25, level: 50, moves: ['thunderbolt'] },
        { speciesId: 6, level: 50, moves: ['flamethrower'] },
      ],
      wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
    })
    // `ally-1` is a real combatant — in the other battle. The ids collide
    // across battles by construction, which is exactly why the check is
    // membership of *this* battle and not the shape of the string.
    expect(two.authority.snapshot().combatants['ally-1']).toBeDefined()
    expect(one.authority.snapshot().combatants['ally-1']).toBeUndefined()
    expectRejected(move(one, 'controller-a:1', 'thunderbolt', 'ally-1'), 'INVALID_TARGET')
    expect(one.authority.revision()).toBe(0)
  })

  it('refuses an offensive move aimed at a Pokémon it would not hit', async () => {
    const harness = await createAuthorityHarness({
      party: [
        { speciesId: 25, level: 50, moves: ['thunderbolt'] },
        { speciesId: 6, level: 50, moves: ['flamethrower'] },
      ],
      wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
    })
    // `ally-1` is in this battle, is not the user, and is not the opponent.
    // Nothing about it is malformed — it is simply not who this would hit, and
    // the server says so rather than quietly redirecting the attack.
    expectRejected(move(harness, 'controller-a:1', 'thunderbolt', 'ally-1'), 'INVALID_TARGET')
    const caught = harness.authority.diagnostics()
    expect(caught[caught.length - 1].check).toBe('target.mismatch')
    expect(harness.authority.revision()).toBe(0)
  })

  it('refuses a stale aim once the battle is decided', async () => {
    const harness = await createAuthorityHarness({
      party: [{ speciesId: 25, level: 50, moves: ['thunderbolt'] }],
      wild: [{ speciesId: 129, level: 5, moves: ['splash'] }],
    })
    move(harness, 'controller-a:1', 'thunderbolt', 'wild-0')
    for (let step = 0; step < 40; step += 1) {
      harness.clock.advance(250)
      harness.room.update()
    }
    // The opponent fainted; the client is a few hundred milliseconds behind
    // and still aiming at it.
    expectRejected(move(harness, 'controller-a:2', 'thunderbolt', 'wild-0'), 'BATTLE_FINISHED')
  })
})

// ── A-4 ─────────────────────────────────────────────────────────────────────

describe('a rejection tells the client the code and the server the story', () => {
  it('sends no internal detail over the wire', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const rejected = send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'wild-0', moveId: harness.moveId('tackle'), targetId: 'ally-0',
    }))
    expect(rejected.kind).toBe('rejected')
    if (rejected.kind !== 'rejected') return

    // Exactly these keys, and no `detail` and no `check` among them.
    expect(Object.keys(rejected).sort()).toEqual(['actionId', 'kind', 'reason', 'revision'])
    const wire = JSON.stringify(rejected)
    expect(wire).not.toContain('detail')
    expect(wire).not.toContain('check')
    expect(wire).not.toContain('controls')
  })

  it('keeps the story server-side, where a test and an incident can read it', async () => {
    const harness = await createAuthorityHarness(DUEL)
    send(harness, actionPayload(harness, 'controller-a:1', {
      kind: 'useMove', combatantId: 'wild-0', moveId: harness.moveId('tackle'), targetId: 'ally-0',
    }))

    const diagnostics = harness.authority.diagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      controllerId: 'controller-a',
      actionId: 'controller-a:1',
      reason: 'NOT_CONTROLLER',
      check: 'controls',
    })
    expect(diagnostics[0].detail.length).toBeGreaterThan(0)
    expect(diagnostics[0].serverTimeMs).toBe(harness.authority.snapshot().serverTimeMs)
  })

  it('names the check that caught each kind of probe, without telling the prober', async () => {
    const harness = await createAuthorityHarness(DUEL)
    const probes: readonly [string, unknown][] = [
      ['controller-a:1', actionPayload(harness, 'controller-a:1', {
        kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 'ghost',
      })],
      ['controller-a:2', actionPayload(harness, 'controller-a:2', {
        kind: 'useMove', combatantId: 'ally-0', moveId: harness.moveId('thunderbolt'), targetId: 'wild-0',
      }, { catalogVersion: 'nope' })],
      ['controller-a:3', actionPayload(harness, 'controller-a:3', { kind: 'useMove' })],
    ]
    const results = probes.map(([, payload]) => send(harness, payload))

    // The server learned where each one broke...
    expect(harness.authority.diagnostics().map(entry => entry.check))
      .toEqual(['target.exists', 'version.catalogSupported', 'schema'])
    // ...and the prober learned only that it was refused.
    for (const result of results) {
      expect(result.kind).toBe('rejected')
      if (result.kind !== 'rejected') continue
      expect('detail' in result).toBe(false)
    }
  })

  it('does not grow without bound, however hard it is probed', async () => {
    const harness = await createAuthorityHarness(DUEL)
    for (let attempt = 1; attempt <= 200; attempt += 1) {
      send(harness, actionPayload(harness, `controller-a:${attempt}`, {
        kind: 'useMove', combatantId: 'wild-0', moveId: harness.moveId('tackle'), targetId: 'ally-0',
      }))
    }
    // A log an attacker can grow is a memory exhaustion bug with good
    // intentions. It keeps the most recent ones, which are the useful ones.
    const kept = harness.authority.diagnostics()
    expect(kept).toHaveLength(64)
    expect(kept[kept.length - 1].actionId).toBe('controller-a:200')
  })
})
