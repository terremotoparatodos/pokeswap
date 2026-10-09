// @vitest-environment node
// ECO-OVERWORLD-BATTLE-1: the overworld battle draws only what the server sent. These run REAL
// snapshots from the existing battle authority (its own test harness: real catalog, manual clock,
// fixed seed) and check that:
//   - HP always equals the latest snapshot (it may go up as well as down);
//   - the action bar between snapshots is only the server's position plus local time, capped full,
//     and frozen while paused, asleep or ended — and it agrees with the server's next snapshot;
//   - events become marks on the right Pokémon; nothing here creates an attack, damage or a result.

import { describe, expect, it } from 'vitest'
import type { AuthorityEventEnvelope, ClientBattleSnapshot } from '../../battle/authority'
import { createAuthorityHarness } from '../../battle/authority/harness'
import { actionBarFill } from '../../battle/rules/actionBar'
import { WILD_COMBATANT, presentCombatant, spectatorSnapshot, stageOf, vfxOf } from './ecoBattlePresentation'
// ECO-BATTLE-SPECTATORS-1: the server's own projection, to check what a spectator draws from it.
import { publicBattleView, publicEvents } from '../../../../services/realtime/src/world/ecoBattlePublic.js'
import type { EcoPublicBattle } from '../../../../services/realtime/src/world/worldProtocol.js'

/** The harness's player combatant (ECO's own battles call it 'player-0'; the adapter takes any id). */
const PLAYER_COMBATANT = 'ally-0'

const colour = (type: string | undefined) => `type:${type ?? 'none'}`

/** A real authoritative battle (the ECO sandbox's own matchup: Pikachu 12 vs a level-8 Rattata). */
async function battle(seed = 7) {
  const h = await createAuthorityHarness({
    party: [{ speciesId: 25, level: 12, moves: ['thunder-shock', 'quick-attack', 'thunder-wave', 'double-team'] }],
    wild: [{ speciesId: 19, level: 8, moves: ['tackle', 'tail-whip'] }],
    seed,
  })
  return {
    h,
    outcome: () => (h.authority.snapshot().outcome.kind === 'ongoing' ? 'ongoing' : 'ended'),
    advance(ms: number) { h.clock.advance(ms); const events = h.authority.tick(); return { events, snapshot: h.authority.snapshot() } },
    snapshot: () => h.authority.snapshot(),
  }
}

const at = (snapshot: ClientBattleSnapshot, receivedAt: number, now: number, connected = true) => ({
  player: presentCombatant(snapshot, PLAYER_COMBATANT, { receivedAt, now, connected })!,
  wild: presentCombatant(snapshot, WILD_COMBATANT, { receivedAt, now, connected })!,
})

describe('presentCombatant · the snapshot is the truth', () => {
  it('HP is the snapshot\'s, through a whole real battle; it may rise (heal) as well as fall', async () => {
    const b = await battle()
    let snapshot = b.snapshot()
    for (let t = 0; t < 60_000 && b.outcome() === 'ongoing'; t += 250) {
      snapshot = b.advance(250).snapshot
      const shown = at(snapshot, 0, 0)
      for (const [id, presented] of [[PLAYER_COMBATANT, shown.player], [WILD_COMBATANT, shown.wild]] as const) {
        const view = snapshot.combatants[id]
        expect(presented.hp).toBe(Math.max(0, view.condition.currentHp ?? view.stats.hp))
        expect(presented.maxHp).toBe(view.stats.hp)
      }
    }
    // a healed snapshot is drawn healed: no "HP only goes down" rule anywhere
    const healed = structuredClone(snapshot) as ClientBattleSnapshot
    ;(healed.combatants[PLAYER_COMBATANT].condition as { currentHp: number }).currentHp = healed.combatants[PLAYER_COMBATANT].stats.hp
    expect(at(healed, 0, 0).player.hpFraction).toBe(1)
  }, 30_000)

  it('between snapshots the bar moves at the local clock only, and agrees with the server\'s next snapshot', async () => {
    const b = await battle()
    const first = b.advance(1).snapshot // a snapshot just after the start: both bars filling, no window yet
    const later = b.advance(400).snapshot // 400 ms more of battle time on the server
    expect(later.revision).toBeGreaterThanOrEqual(first.revision)
    const interpolated = at(first, 10_000, 10_400)
    const truth = at(later, 0, 0)
    expect(interpolated.player.actionFill).toBeCloseTo(truth.player.actionFill, 6)
    expect(interpolated.wild.actionFill).toBeCloseTo(truth.wild.actionFill, 6)
    // the server's own position, untouched, when no time has passed locally
    expect(at(first, 5, 5).player.actionFill).toBeLessThan(interpolated.player.actionFill)
  })

  it('the client view gives the same fill as the canonical server state (the core formula, not a copy)', async () => {
    const b = await battle()
    for (let t = 0; t < 8_000; t += 333) {
      const snapshot = b.advance(333).snapshot
      const state = b.h.authority.internal().state
      for (const id of [PLAYER_COMBATANT, WILD_COMBATANT]) {
        const canonical = state.combatants[id]
        if (!canonical) continue
        expect(presentCombatant(snapshot, id, { receivedAt: 0, now: 0, connected: true })!.actionFill).toBe(Math.min(1, actionBarFill(canonical, state.config)))
      }
    }
  })

  it('a full bar waits for the server: capped at 1, and nothing else changes (no HP, no result)', async () => {
    const b = await battle()
    const snapshot = b.advance(1).snapshot
    const long = at(snapshot, 0, 60_000)
    expect(long.player.actionFill).toBe(1)
    expect(long.wild.actionFill).toBe(1)
    expect([long.player.hp, long.wild.hp]).toEqual([at(snapshot, 0, 0).player.hp, at(snapshot, 0, 0).wild.hp])
  })

  it('frozen while the server pauses (disconnected), while asleep and once the battle ended', async () => {
    const b = await battle()
    const snapshot = b.advance(1).snapshot
    const still = at(snapshot, 0, 0).player.actionFill
    expect(at(snapshot, 0, 3_000, false).player.actionFill).toBe(still)
    const asleep = structuredClone(snapshot) as ClientBattleSnapshot
    ;(asleep.combatants[PLAYER_COMBATANT].condition as { majorStatus: string }).majorStatus = 'sleep'
    expect(at(asleep, 0, 3_000).player.actionFill).toBe(at(asleep, 0, 0).player.actionFill)
    expect(at(asleep, 0, 0).player.status).toBe('sleep')
    const ended = structuredClone(snapshot) as ClientBattleSnapshot
    ;(ended as { outcome: unknown }).outcome = { kind: 'decided', winningSideId: 'player' }
    expect(at(ended, 0, 3_000).player.actionFill).toBe(at(ended, 0, 0).player.actionFill)
  })
})

describe('vfxOf · the server\'s events as marks, nothing more', () => {
  it('a real battle\'s events become marks on the two combatants; every DAMAGE shows its amount', async () => {
    const b = await battle()
    const events: AuthorityEventEnvelope[] = []
    for (let t = 0; t < 60_000 && b.outcome() === 'ongoing'; t += 250) events.push(...b.advance(250).events)
    const vfx = vfxOf(events, null, colour)
    expect(vfx.length).toBeGreaterThan(0)
    for (const mark of vfx) expect([PLAYER_COMBATANT, WILD_COMBATANT]).toContain(mark.at)
    const damage = events.filter(e => e.event.type === 'DAMAGE')
    expect(vfx.filter(m => m.type === 'text' && m.text.startsWith('-'))).toHaveLength(damage.length)
    expect(vfx.some(m => m.type === 'text' && m.text === 'debilitado')).toBe(true)
  }, 30_000)

  it('maps each kind: special flies from the attacker, heal and protect have their own marks', () => {
    const e = (event: Record<string, unknown>) => ({ battleId: 'b', sequence: 1, revision: 1, actionId: null, serverTimeMs: 0, event }) as unknown as AuthorityEventEnvelope
    const catalog = { move: (id: number) => (id === 1 ? { type: 'electric', category: 'special' } : { type: 'normal', category: 'status' }) } as never
    const vfx = vfxOf([
      e({ type: 'MOVE_USED', combatantId: 'player-0', moveId: 1, targetId: 'wild-0', hits: 1 }),
      e({ type: 'MOVE_USED', combatantId: 'wild-0', moveId: 2, targetId: null, hits: 1 }),
      e({ type: 'HEAL', combatantId: 'player-0', amount: 5, remainingHp: 30, cause: 'drain' }),
      e({ type: 'PROTECT_BLOCKED', combatantId: 'wild-0', sourceId: 'player-0', moveId: 1, chargesLeft: 1 }),
      e({ type: 'MOVE_MISSED', combatantId: 'player-0', moveId: 1 }),
      e({ type: 'ACTION_READY', combatantId: 'player-0' }),
    ], catalog, colour)
    expect(vfx).toEqual([
      { type: 'effect', kind: 'special', at: 'wild-0', from: 'player-0', colour: 'type:electric', life: 0.42 },
      { type: 'effect', kind: 'statusHit', at: 'wild-0', colour: 'type:normal', life: 0.6 },
      { type: 'effect', kind: 'heal', at: 'player-0', colour: '#7be08f', life: 0.6 },
      { type: 'text', at: 'player-0', text: '+5', colour: '#9ff0b8', life: 0.9 },
      { type: 'effect', kind: 'shield', at: 'wild-0', colour: '#9fc6ff', life: 0.5 },
      { type: 'text', at: 'player-0', text: 'falló', colour: '#dce6ff', life: 0.9 },
    ])
  })
})

describe('stageOf · where the Pikachu stands', () => {
  it('one tile from the trainer toward the wild Pokémon, both facing each other', () => {
    expect(stageOf({ player: { tx: 0, ty: 0 }, wild: { tx: 4, ty: 1 } })).toEqual({ pikachu: { tx: 1, ty: 0 }, pikachuFacing: 'right', wildFacing: 'left' })
    expect(stageOf({ player: { tx: 0, ty: 0 }, wild: { tx: -1, ty: -5 } })).toEqual({ pikachu: { tx: 0, ty: -1 }, pikachuFacing: 'up', wildFacing: 'down' })
    expect(stageOf({ player: { tx: 3, ty: 3 }, wild: { tx: 4, ty: 3 } }).pikachu).toEqual({ tx: 3, ty: 3 })
  })
})

describe('spectatorSnapshot · a spectator draws what the owner draws (ECO-BATTLE-SPECTATORS-1)', () => {
  /** The owner's snapshot with the ECO combatant ids, through the server's projection and the wire (JSON). */
  const asSpectator = (owner: ClientBattleSnapshot, connected = true): EcoPublicBattle => {
    const renamed = { ...owner, combatants: { 'player-0': owner.combatants[PLAYER_COMBATANT], 'wild-0': owner.combatants[WILD_COMBATANT] } }
    const stage = { owner: { tx: 0, ty: 0 }, wild: { tx: 3, ty: 0 } }
    return JSON.parse(JSON.stringify(publicBattleView({ battleId: 'b', encounterId: 'e', areaId: 'pradera', seq: 1, stage, snapshot: renamed, connected })))
  }
  // A decided snapshot reaches a spectator with `ended` in the same server tick (the end is published right after it).
  const same = (owner: ClientBattleSnapshot, receivedAt: number, now: number, connected = true, ended = owner.outcome.kind !== 'ongoing') => {
    const theirs = spectatorSnapshot(asSpectator(owner, connected), ended)
    for (const [mine, public_] of [[PLAYER_COMBATANT, 'player-0'], [WILD_COMBATANT, 'wild-0']] as const) {
      const a = presentCombatant(owner, mine, { receivedAt, now, connected })!
      const b = presentCombatant(theirs, public_, { receivedAt, now, connected })!
      expect({ ...b, combatantId: a.combatantId }).toEqual(a)
    }
  }

  it('HP, status, level, species and the interpolated action bar are identical, through a whole real battle', async () => {
    const b = await battle()
    let checked = 0
    for (let i = 0; i < 600 && b.outcome() === 'ongoing'; i++) {
      const { snapshot } = b.advance(100)
      for (const elapsed of [0, 250, 900, 5_000]) same(snapshot, 1_000, 1_000 + elapsed)
      checked++
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('paused (owner disconnected) and ended: frozen, like the owner’s', async () => {
    const b = await battle()
    const { snapshot } = b.advance(700)
    same(snapshot, 0, 2_000, false)
    const theirs = spectatorSnapshot(asSpectator(snapshot), true)
    const frozen = presentCombatant(theirs, 'player-0', { receivedAt: 0, now: 0, connected: true })!
    expect(presentCombatant(theirs, 'player-0', { receivedAt: 0, now: 3_000, connected: true })!.actionFill).toBe(frozen.actionFill)
  })

  it('the public events give the same marks as the owner’s events (same effects, decision P3)', async () => {
    const b = await battle()
    const events: AuthorityEventEnvelope[] = []
    for (let i = 0; i < 400 && events.length < 20; i++) events.push(...b.advance(100).events)
    const rename = (id: unknown) => (id === PLAYER_COMBATANT ? 'player-0' : id)
    const owners = events.map(e => ({ ...e, event: { ...e.event, ...('combatantId' in e.event ? { combatantId: rename(e.event.combatantId) } : {}), ...('targetId' in e.event ? { targetId: rename(e.event.targetId) } : {}), ...('sourceId' in e.event ? { sourceId: rename(e.event.sourceId) } : {}) } })) as unknown as AuthorityEventEnvelope[]
    const wire = JSON.parse(JSON.stringify(publicEvents(owners))) as AuthorityEventEnvelope[]
    expect(vfxOf(wire, null, colour)).toEqual(vfxOf(owners, null, colour))
    expect(vfxOf(owners, null, colour).length).toBeGreaterThan(0)
  })
})
