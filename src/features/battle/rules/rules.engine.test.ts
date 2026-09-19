// The engine, on real battles (R32.3).
//
// Every test here drives `reduceBattle` with commands and reads events. None
// of them reaches into the state to make something happen: if a rule cannot be
// observed from the outside it is not a rule, it is an implementation detail.
//
// Where a test needs a certainty out of something the rules roll, it changes
// the **config** rather than the seed — the config travels inside the state
// exactly so that a battle can be set up honestly.

import { describe, expect, it } from 'vitest'
import { DEFAULT_BATTLE_RULES_CONFIG } from './config'
import type { BattleRulesConfig } from './config'
import type { BattleCommand } from './commands'
import type { BattleEvent } from './events'
import { cooldownMs } from './actionBar'
import { reduceBattle } from './reduce'
import { finishBattle } from './setup'
import { currentHpOf, isCombatantFainted } from './state'
import type { BattleCombatant, BattleState, CombatantRuntime } from './state'
import type { PokemonConditionState } from '../../pokemon/model'
import { buildSampleBattle, CHARIZARD_VS_AZUMARILL, PIKACHU_VS_GENGAR } from './sampleBattles'
import type { SampleBattle, SampleBattleInput } from './sampleBattles'

// ── Helpers ─────────────────────────────────────────────────────────────────

function play(
  battle: SampleBattle, state: BattleState, commands: readonly BattleCommand[],
): { state: BattleState; events: BattleEvent[] } {
  let current = state
  const events: BattleEvent[] = []
  for (const command of commands) {
    const step = reduceBattle(current, command, battle.context)
    current = step.state
    events.push(...step.events)
  }
  return { state: current, events }
}

const advance = (deltaMs: number): BattleCommand => ({ type: 'ADVANCE_TIME', deltaMs })
const ticks = (count: number, deltaMs = 250): BattleCommand[] =>
  Array.from({ length: count }, () => advance(deltaMs))

function patch(
  state: BattleState,
  combatantId: string,
  changes: { condition?: Partial<PokemonConditionState>; runtime?: Partial<CombatantRuntime> },
): BattleState {
  const combatant = state.combatants[combatantId]
  const next: BattleCombatant = {
    ...combatant,
    condition: { ...combatant.condition, ...changes.condition },
    runtime: { ...combatant.runtime, ...changes.runtime },
  }
  return { ...state, combatants: { ...state.combatants, [combatantId]: next } }
}

const withConfig = (state: BattleState, config: BattleRulesConfig): BattleState => ({ ...state, config })

/** No crits, so a test can assert on an exact number without hunting for a seed. */
const NO_CRITS: BattleRulesConfig = {
  ...DEFAULT_BATTLE_RULES_CONFIG,
  damage: { ...DEFAULT_BATTLE_RULES_CONFIG.damage, critChanceByStage: [0, 0, 0, 0] },
}

const typesOf = <T extends BattleEvent['type']>(events: readonly BattleEvent[], type: T) =>
  events.filter(event => event.type === type) as Extract<BattleEvent, { type: T }>[]

const DUEL: SampleBattleInput = {
  battleId: 'engine', seed: 4242,
  ally: { speciesId: 25, level: 50, moves: ['thunderbolt', 'quick-attack', 'thunder-wave', 'double-slap'] },
  enemy: { speciesId: 143, level: 50, wild: true, moves: ['body-slam', 'toxic', 'fury-swipes', 'protect'] },
}

/**
 * Two Shuckle: the least interesting fight in Generation VI, and exactly what
 * a timing test wants. Enormous defences, one damage a hit and a four-second
 * Action Bar, so nothing ends before the clock is done being read.
 */
const SLOW: SampleBattleInput = {
  battleId: 'slow', seed: 101,
  ally: { speciesId: 213, level: 50, moves: ['tackle', 'protect', 'fury-swipes'] },
  enemy: { speciesId: 213, level: 50, wild: true, moves: ['tackle', 'fury-swipes'] },
}

/** A fast attacker against a wall: cooldowns can be read straight off the events. */
const FAST_VS_WALL: SampleBattleInput = {
  battleId: 'fast', seed: 55,
  ally: { speciesId: 25, level: 50, moves: ['thunderbolt', 'quick-attack', 'hyper-beam'] },
  enemy: { speciesId: 213, level: 50, wild: true, moves: ['tackle'] },
}

// ── Commands are intentions ─────────────────────────────────────────────────

describe('commands are intentions, not mutations', () => {
  it('does nothing until the Action Bar fills', async () => {
    const battle = await buildSampleBattle(DUEL)
    const selected = play(battle, battle.state, [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('thunderbolt') },
    ])
    expect(typesOf(selected.events, 'MOVE_USED')).toHaveLength(0)
    expect(selected.state.timeMs).toBe(0)
    expect(selected.state.combatants['ally-0'].runtime.selected).toEqual({
      kind: 'move', moveId: battle.moveId('thunderbolt'),
    })

    const later = play(battle, selected.state, [advance(2000)])
    expect(typesOf(later.events, 'MOVE_USED').length).toBeGreaterThan(0)
  })

  it('returns the very same state object when a command is refused', async () => {
    const battle = await buildSampleBattle(DUEL)
    const refusals: BattleCommand[] = [
      { type: 'USE_MOVE', combatantId: 'nobody', moveId: 1 },
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('surf') },
      { type: 'SWITCH', combatantId: 'ally-0', incomingId: 'enemy-0' },
      { type: 'CAPTURE', combatantId: 'ally-0', targetId: 'ally-0', ball: { id: 'poke-ball', bonus: 1 } },
      { type: 'USE_ITEM', combatantId: 'ally-0', targetId: 'enemy-0', item: { kind: 'healHp', amount: 20 } },
      advance(0),
      advance(-500),
      { type: 'ADVANCE_TIME', deltaMs: 16.7 },
    ]
    for (const command of refusals) {
      const result = reduceBattle(battle.state, command, battle.context)
      expect(result.state, JSON.stringify(command)).toBe(battle.state)
      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('COMMAND_REJECTED')
    }
  })

  it('refuses a move these rules defer, at selection time and with the reason', async () => {
    const battle = await buildSampleBattle({
      ...DUEL,
      // Growth raises one stage normally and two in sun, so the catalog refuses
      // to state it and these rules refuse to approximate it.
      ally: { speciesId: 25, level: 50, moves: ['thunderbolt', 'growth'] },
    })
    const result = reduceBattle(
      battle.state,
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('growth') },
      battle.context,
    )
    expect(result.state).toBe(battle.state)
    expect(result.events[0]).toMatchObject({
      type: 'COMMAND_REJECTED',
      reason: expect.stringContaining('stat change not stated by the pinned sources'),
    })
  })

  it('refuses a state built for another catalog or another rules version', async () => {
    const battle = await buildSampleBattle(DUEL)
    const otherCatalog = { ...battle.state, catalogVersion: '1.oras.deadbeef0000' }
    const otherRules = { ...battle.state, battleRulesVersion: 'pokeswap-battle-v99' }
    for (const state of [otherCatalog, otherRules]) {
      const result = reduceBattle(state, advance(1000), battle.context)
      expect(result.state).toBe(state)
      expect(result.events[0].type).toBe('COMMAND_REJECTED')
    }
  })
})

// ── PP, auto-repeat and Struggle ────────────────────────────────────────────

describe('PP and the fallback chain', () => {
  it('spends one PP per use and keeps repeating the selected move', async () => {
    const battle = await buildSampleBattle(DUEL)
    const thunderbolt = battle.moveId('thunderbolt')
    const result = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: thunderbolt },
      ...ticks(16),
    ])
    const spent = typesOf(result.events, 'PP_CHANGED').filter(e => e.combatantId === 'ally-0')
    expect(spent.length).toBeGreaterThan(1)
    expect(spent.map(e => e.remaining)).toEqual(spent.map((_, index) => 14 - index))
    expect(spent.every(e => e.max === 15)).toBe(true)
  })

  it('falls back to the first usable move when nothing was ever selected', async () => {
    const battle = await buildSampleBattle(DUEL)
    const result = play(battle, battle.state, ticks(12))
    const used = typesOf(result.events, 'MOVE_USED').filter(e => e.combatantId === 'ally-0')
    expect(used.length).toBeGreaterThan(0)
    expect(used[0].moveId).toBe(battle.moveId('thunderbolt'))
  })

  it('reaches Struggle when every slot is empty, and it costs a quarter of max HP', async () => {
    const battle = await buildSampleBattle({
      ...DUEL,
      ally: { speciesId: 25, level: 50, moves: ['thunderbolt'] },
    })
    const empty = patch(withConfig(battle.state, NO_CRITS), 'ally-0', {
      condition: { pp: { [battle.moveId('thunderbolt')]: 0 } },
    })
    const result = play(battle, empty, [advance(2000)])
    expect(typesOf(result.events, 'ACTION_STARTED').some(e => e.action === 'struggle')).toBe(true)
    const recoil = typesOf(result.events, 'DAMAGE').find(e => e.cause === 'recoil')
    expect(recoil?.combatantId).toBe('ally-0')
    expect(recoil?.amount).toBe(Math.floor(battle.state.combatants['ally-0'].stats.hp / 4))
  })

  it('lets Struggle hit a Ghost type, which a Normal move cannot', async () => {
    const battle = await buildSampleBattle({
      battleId: 'struggle-ghost', seed: 5,
      ally: { speciesId: 25, level: 50, moves: ['quick-attack'] },
      enemy: { speciesId: 94, level: 50, wild: true, moves: ['confuse-ray'] },
    })
    const quickAttack = battle.moveId('quick-attack')
    const normal = play(battle, withConfig(battle.state, NO_CRITS), [advance(2000)])
    expect(typesOf(normal.events, 'DAMAGE').filter(e => e.combatantId === 'enemy-0' && e.amount > 0))
      .toHaveLength(0)

    const empty = patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { pp: { [quickAttack]: 0 } } })
    const struggling = play(battle, empty, [advance(2000)])
    expect(typesOf(struggling.events, 'DAMAGE').some(e => e.combatantId === 'enemy-0' && e.amount > 0)).toBe(true)
  })

  it('falls through a selected move that ran out of PP instead of stalling', async () => {
    const battle = await buildSampleBattle(DUEL)
    const thunderbolt = battle.moveId('thunderbolt')
    const start = patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { pp: { [thunderbolt]: 0 } } })
    const selected = reduceBattle(
      start, { type: 'USE_MOVE', combatantId: 'ally-0', moveId: thunderbolt }, battle.context,
    )
    // Selecting it is refused outright; the Pokémon still acts with another move.
    expect(selected.events[0].type).toBe('COMMAND_REJECTED')
    const result = play(battle, start, [advance(2000)])
    const used = typesOf(result.events, 'MOVE_USED').find(e => e.combatantId === 'ally-0')
    expect(used?.moveId).toBe(battle.moveId('quick-attack'))
  })
})

// ── Priority, recharge and Protect ──────────────────────────────────────────

describe('the realtime readings of priority, recharge and Protect', () => {
  const windowsOf = async (input: SampleBattleInput, moveName: string): Promise<number[]> => {
    const battle = await buildSampleBattle(input)
    const run = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId(moveName) },
      ...ticks(40),
    ])
    return typesOf(run.events, 'ACTION_STARTED').filter(e => e.combatantId === 'ally-0').map(e => e.atMs)
  }

  it('halves the next cooldown after a priority move', async () => {
    const plain = await windowsOf(FAST_VS_WALL, 'thunderbolt')
    const quick = await windowsOf(FAST_VS_WALL, 'quick-attack')
    expect(plain.length).toBeGreaterThan(2)
    // The first window is the same; every one after it comes twice as fast.
    expect(quick[0]).toBe(plain[0])
    expect(quick[1] - quick[0]).toBe(Math.round((plain[1] - plain[0]) / 2))
    expect(quick.length).toBeGreaterThan(plain.length)
  })

  it('doubles the next cooldown after a recharge move', async () => {
    const plain = await windowsOf(FAST_VS_WALL, 'thunderbolt')
    const beam = await windowsOf(FAST_VS_WALL, 'hyper-beam')
    expect(beam[0]).toBe(plain[0])
    expect(beam[1] - beam[0]).toBe((plain[1] - plain[0]) * 2)
  })

  it('absorbs two offensive actions and then costs its user an Action Window', async () => {
    const battle = await buildSampleBattle({
      battleId: 'protect', seed: 31,
      ally: { speciesId: 213, level: 50, moves: ['protect', 'tackle'] },
      enemy: { speciesId: 25, level: 50, wild: true, moves: ['quick-attack'] },
    })
    const result = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('protect') },
      ...ticks(20),
      { type: 'CLEAR_SELECTION', combatantId: 'ally-0' },
      ...ticks(40),
    ])
    const blocked = typesOf(result.events, 'PROTECT_BLOCKED')
    expect(blocked.length).toBeGreaterThanOrEqual(2)
    expect(blocked[0].chargesLeft).toBe(1)
    expect(blocked.some(e => e.chargesLeft === 0)).toBe(true)
    const expired = typesOf(result.events, 'PROTECT_EXPIRED')
    expect(expired.length).toBeGreaterThan(0)
    // Once the shield is down the hits land again.
    expect(typesOf(result.events, 'DAMAGE')
      .some(e => e.combatantId === 'ally-0' && e.seq > expired[0].seq)).toBe(true)
  })

  /**
   * Auto-repeat keeps Protect selected, so without this rule a Pokémon would
   * top its shield back up every window and never be hit again.
   */
  it('does not refresh a shield that is still up, and says so', async () => {
    const battle = await buildSampleBattle({
      battleId: 'protect-no-refresh', seed: 5,
      ally: { speciesId: 213, level: 50, moves: ['protect'] },
      enemy: { speciesId: 213, level: 50, wild: true, moves: ['tackle'] },
    })
    const protectId = battle.moveId('protect')
    const maxPp = battle.catalog.move(protectId)!.pp
    const result = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: protectId },
      ...ticks(40),
    ])

    const gained = typesOf(result.events, 'PROTECT_GAINED')
    const failed = typesOf(result.events, 'PROTECT_FAILED')
    expect(gained.length).toBeGreaterThan(0)
    expect(failed.length).toBeGreaterThan(0)
    // Every failure happened while a charge was still up.
    expect(failed.every(event => event.chargesLeft > 0)).toBe(true)
    // A new shield only ever appears after the previous one is gone.
    for (const event of gained.slice(1)) {
      const previous = result.events.filter(e => e.seq < event.seq)
      const last = [...previous].reverse()
        .find(e => e.type === 'PROTECT_EXPIRED' || e.type === 'PROTECT_GAINED')
      expect(last?.type).toBe('PROTECT_EXPIRED')
    }
    // And the failed attempt is not free: it spent its window and its PP.
    const spent = typesOf(result.events, 'PP_CHANGED').filter(e => e.moveId === protectId)
    expect(spent.length).toBe(gained.length + failed.length)
    expect(spent[spent.length - 1].remaining).toBe(maxPp - spent.length)
  })

  it('spends one Protect charge for a whole multi-hit move, not one per hit', async () => {
    const battle = await buildSampleBattle({
      battleId: 'protect-multihit', seed: 8,
      ally: { speciesId: 213, level: 50, moves: ['protect'] },
      enemy: { speciesId: 213, level: 50, wild: true, moves: ['fury-swipes'] },
    })
    const result = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('protect') },
      ...ticks(16),
    ])
    const first = typesOf(result.events, 'PROTECT_BLOCKED')[0]
    expect(first.moveId).toBe(battle.moveId('fury-swipes'))
    expect(first.chargesLeft).toBe(1)
  })
})

// ── Stat changes ────────────────────────────────────────────────────────────

describe('stat changes, read from the catalog', () => {
  /** Two Shuckle so nothing dies while the stages are being read. */
  const withMoves = (ally: readonly string[], enemy: readonly string[] = ['tackle']): SampleBattleInput => ({
    battleId: `stat-${ally.join('-')}`, seed: 404,
    ally: { speciesId: 213, level: 50, moves: ally },
    enemy: { speciesId: 213, level: 50, wild: true, moves: enemy },
  })

  const stagesAfter = async (
    input: SampleBattleInput, moveName: string, windows: number,
  ): Promise<{ state: BattleState; events: BattleEvent[]; battle: SampleBattle }> => {
    const battle = await buildSampleBattle(input)
    const run = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId(moveName) },
      ...ticks(windows * 18),
    ])
    return { ...run, battle }
  }

  it('Swords Dance raises the user two stages, and a second one changes nothing', async () => {
    const { state, events } = await stagesAfter(withMoves(['swords-dance']), 'swords-dance', 2)
    expect(state.combatants['ally-0'].runtime.stages.atk).toBe(2)

    const changed = typesOf(events, 'STAT_STAGE_CHANGED').filter(e => e.combatantId === 'ally-0')
    expect(changed[0]).toMatchObject({ stat: 'atk', delta: 2, stage: 2, sourceId: 'ally-0' })
    // Auto-repeat uses it again; the ceiling holds and the engine says so.
    expect(typesOf(events, 'STAT_STAGE_UNCHANGED')).toContainEqual(
      expect.objectContaining({ combatantId: 'ally-0', stat: 'atk', stage: 2, reason: 'atCeiling' }),
    )
    expect(changed).toHaveLength(1)
  })

  it('Growl lowers the enemy Attack by one', async () => {
    const { state, events } = await stagesAfter(withMoves(['growl']), 'growl', 1)
    expect(state.combatants['enemy-0'].runtime.stages.atk).toBe(-1)
    expect(typesOf(events, 'STAT_STAGE_CHANGED')[0])
      .toMatchObject({ combatantId: 'enemy-0', stat: 'atk', delta: -1, stage: -1, sourceId: 'ally-0' })
  })

  it('Tail Whip lowers the enemy Defence by one', async () => {
    const { state } = await stagesAfter(withMoves(['tail-whip']), 'tail-whip', 1)
    expect(state.combatants['enemy-0'].runtime.stages.def).toBe(-1)
  })

  it('Screech lowers the enemy Defence by two', async () => {
    // Screech is 85 % accurate, so it is given a few windows to land.
    const { state, events } = await stagesAfter(withMoves(['screech']), 'screech', 4)
    expect(state.combatants['enemy-0'].runtime.stages.def).toBe(-2)
    expect(typesOf(events, 'STAT_STAGE_CHANGED')[0])
      .toMatchObject({ combatantId: 'enemy-0', stat: 'def', delta: -2, stage: -2 })
  })

  it('Agility raises Speed, and the Action Bar gets shorter for it', async () => {
    const battle = await buildSampleBattle(withMoves(['agility']))
    const before = cooldownMs(battle.state.combatants['ally-0'], battle.state.config)

    const run = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('agility') },
      ...ticks(20),
    ])
    const after = run.state.combatants['ally-0']
    expect(after.runtime.stages.spe).toBe(2)
    // ×2 Speed, and the bar is the square root of that: shorter, not halved.
    expect(cooldownMs(after, run.state.config)).toBeLessThan(before)
    // The persistent stat never moved; only the runtime did.
    expect(after.stats.spe).toBe(battle.state.combatants['ally-0'].stats.spe)
  })

  it('applies a damaging move secondary stat change, and rolls it', async () => {
    // Charge Beam: 70 % to raise the user's Sp. Attack. Certain and impossible
    // are both reachable from the config, so both can be asserted.
    const always: BattleRulesConfig = { ...NO_CRITS }
    const battle = await buildSampleBattle(withMoves(['charge-beam']))
    const run = play(battle, withConfig(battle.state, always), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('charge-beam') },
      ...ticks(40),
    ])
    const boosted = typesOf(run.events, 'STAT_STAGE_CHANGED')
      .filter(e => e.combatantId === 'ally-0' && e.stat === 'spa')
    expect(boosted.length).toBeGreaterThan(0)
    // Every boost lands after the damage of the hit that caused it.
    const firstDamage = typesOf(run.events, 'DAMAGE').find(e => e.sourceId === 'ally-0')
    expect(boosted[0].seq).toBeGreaterThan(firstDamage!.seq)
    expect(run.state.combatants['ally-0'].runtime.stages.spa).toBeGreaterThan(0)
  })

  it('applies a guaranteed self-drop: Overheat costs the user two Sp. Attack', async () => {
    const battle = await buildSampleBattle({
      battleId: 'overheat', seed: 12,
      ally: { speciesId: 6, level: 50, moves: ['overheat'] },
      enemy: { speciesId: 213, level: 50, wild: true, moves: ['tackle'] },
    })
    const run = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('overheat') },
      ...ticks(10),
    ])
    expect(run.state.combatants['ally-0'].runtime.stages.spa).toBe(-2)
  })

  it('still refuses the ones the sources do not settle', async () => {
    const battle = await buildSampleBattle(withMoves(['growth', 'tackle']))
    const run = play(battle, withConfig(battle.state, NO_CRITS), ticks(40))
    // The fallback skips it: it has PP, but no rule can run it.
    const used = typesOf(run.events, 'MOVE_USED').filter(e => e.combatantId === 'ally-0')
    expect(used.length).toBeGreaterThan(0)
    expect(used.every(e => e.moveId === battle.moveId('tackle'))).toBe(true)
    expect(typesOf(run.events, 'STAT_STAGE_CHANGED')).toHaveLength(0)
  })

  it('drops the stages on a switch and never on the instance', async () => {
    const battle = await buildSampleBattle({
      ...withMoves(['swords-dance']),
      bench: [{ speciesId: 6, level: 50, moves: ['flamethrower'] }],
    })
    const run = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('swords-dance') },
      ...ticks(20),
      { type: 'SWITCH', combatantId: 'ally-0', incomingId: 'ally-1' },
      ...ticks(20),
    ])
    expect(run.state.combatants['ally-0'].runtime.stages).toEqual({})
    const after = finishBattle(run.state)
    expect(JSON.stringify(after['ally-0'])).not.toContain('stages')
  })
})

// ── Multi-hit, recoil and drain ─────────────────────────────────────────────

describe('multi-hit, recoil and drain', () => {
  it('emits one damage event per hit of a 2–5 hit move', async () => {
    const battle = await buildSampleBattle(DUEL)
    const result = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('double-slap') },
      ...ticks(8),
    ])
    const used = typesOf(result.events, 'MOVE_USED').find(e => e.moveId === battle.moveId('double-slap'))
    expect(used).toBeDefined()
    const hits = typesOf(result.events, 'DAMAGE')
      .filter(e => e.cause === 'move' && e.sourceId === 'ally-0' && e.seq > used!.seq && e.seq < used!.seq + 12)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.map(e => e.hit)).toEqual(hits.map((_, index) => index + 1))
  })

  it('takes recoil after the damage, and it can faint the attacker', async () => {
    const battle = await buildSampleBattle({
      battleId: 'recoil', seed: 12,
      ally: { speciesId: 6, level: 50, moves: ['double-edge'] },
      enemy: { speciesId: 143, level: 50, wild: true, moves: ['body-slam'] },
    })
    const brittle = patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { currentHp: 3 } })
    const result = play(battle, brittle, [advance(2000)])
    const recoil = typesOf(result.events, 'DAMAGE').find(e => e.cause === 'recoil')
    const hit = typesOf(result.events, 'DAMAGE').find(e => e.cause === 'move')
    expect(hit).toBeDefined()
    expect(recoil).toBeDefined()
    expect(recoil!.seq).toBeGreaterThan(hit!.seq)
    expect(typesOf(result.events, 'FAINTED').some(e => e.combatantId === 'ally-0')).toBe(true)
  })

  it('heals from a drain move, and never above max HP', async () => {
    const battle = await buildSampleBattle({
      battleId: 'drain', seed: 19,
      ally: { speciesId: 6, level: 50, moves: ['giga-drain'] },
      enemy: { speciesId: 184, level: 50, wild: true, moves: ['body-slam'] },
    })
    const hurt = patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { currentHp: 10 } })
    const result = play(battle, hurt, [advance(2000)])
    const heal = typesOf(result.events, 'HEAL').find(e => e.cause === 'drain')
    expect(heal).toBeDefined()
    expect(heal!.remainingHp).toBeLessThanOrEqual(battle.state.combatants['ally-0'].stats.hp)

    const nearlyFull = patch(withConfig(battle.state, NO_CRITS), 'ally-0', {
      condition: { currentHp: battle.state.combatants['ally-0'].stats.hp - 1 },
    })
    const capped = play(battle, nearlyFull, [advance(2000)])
    const cappedHeal = typesOf(capped.events, 'HEAL').find(e => e.cause === 'drain')
    expect(cappedHeal?.amount).toBe(1)
  })
})

// ── Major status ────────────────────────────────────────────────────────────

describe('major status', () => {
  it('applies one and refuses a second', async () => {
    const battle = await buildSampleBattle(DUEL)
    const result = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('thunder-wave') },
      ...ticks(16),
    ])
    const applied = typesOf(result.events, 'STATUS_APPLIED').filter(e => e.combatantId === 'enemy-0')
    expect(applied[0].status).toBe('paralysis')
    expect(applied).toHaveLength(1)
    expect(typesOf(result.events, 'STATUS_FAILED').some(e => e.reason === 'alreadyHasMajorStatus')).toBe(true)
    expect(result.state.combatants['enemy-0'].condition.majorStatus).toBe('paralysis')
  })

  it('answers the type chart: Thunder Wave does not paralyse a Ground type', async () => {
    const battle = await buildSampleBattle({
      battleId: 'ground', seed: 2,
      ally: { speciesId: 25, level: 50, moves: ['thunder-wave'] },
      enemy: { speciesId: 51, level: 50, wild: true, moves: ['tackle'] },
    })
    const result = play(battle, withConfig(battle.state, NO_CRITS), [
      { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('thunder-wave') },
      ...ticks(24),
    ])
    expect(typesOf(result.events, 'STATUS_APPLIED').filter(e => e.combatantId === 'enemy-0')).toHaveLength(0)
    expect(typesOf(result.events, 'STATUS_FAILED')
      .some(e => e.combatantId === 'enemy-0' && e.reason === 'missed')).toBe(true)
  })

  it('ticks poison on its own clock, 1/16 of max HP every three seconds', async () => {
    const battle = await buildSampleBattle(SLOW)
    const maxHp = battle.state.combatants['enemy-0'].stats.hp
    const poisoned = patch(withConfig(battle.state, NO_CRITS), 'enemy-0', {
      condition: { majorStatus: 'poison' },
      runtime: { nextPoisonTickMs: 3000 },
    })
    const result = play(battle, poisoned, ticks(40))
    const tickEvents = typesOf(result.events, 'STATUS_TICK').filter(e => e.combatantId === 'enemy-0')
    expect(tickEvents.length).toBeGreaterThanOrEqual(3)
    expect(tickEvents.map(e => e.atMs).slice(0, 3)).toEqual([3000, 6000, 9000])
    expect(tickEvents[0].damage).toBe(Math.floor(maxHp / 16))
  })

  it('makes sleep eat Action Windows and wake up on the clock', async () => {
    const battle = await buildSampleBattle(SLOW)
    const asleep = patch(withConfig(battle.state, NO_CRITS), 'ally-0', {
      condition: { majorStatus: 'sleep' },
      runtime: { sleepRemainingMs: 6000 },
    })
    const result = play(battle, asleep, ticks(48))
    const woke = typesOf(result.events, 'STATUS_ENDED').find(e => e.combatantId === 'ally-0')
    expect(woke?.atMs).toBe(6000)
    expect(woke?.status).toBe('sleep')
    const actedWhileAsleep = typesOf(result.events, 'ACTION_STARTED')
      .filter(e => e.combatantId === 'ally-0' && e.atMs < 6000)
    expect(actedWhileAsleep).toHaveLength(0)
    expect(typesOf(result.events, 'ACTION_STARTED').some(e => e.combatantId === 'ally-0')).toBe(true)
  })

  it('halves Attack when burnt and Sp. Attack when frozen, and never immobilises', async () => {
    const battle = await buildSampleBattle({
      battleId: 'burn-freeze', seed: 77,
      ally: { speciesId: 143, level: 50, moves: ['body-slam'] },
      enemy: { speciesId: 213, level: 50, wild: true, moves: ['tackle'] },
    })
    const healthy = play(battle, withConfig(battle.state, NO_CRITS), [advance(3000)])
    const burnt = play(
      battle,
      patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { majorStatus: 'burn' } }),
      [advance(3000)],
    )
    const hitOf = (run: { events: BattleEvent[] }) =>
      typesOf(run.events, 'DAMAGE').find(e => e.sourceId === 'ally-0' && e.cause === 'move')?.amount ?? 0
    expect(hitOf(burnt)).toBeLessThan(hitOf(healthy))

    // A frozen Pokémon still acts: PokeSwap's freeze is a Sp. Attack cut.
    const frozen = play(
      battle,
      patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { majorStatus: 'freeze' } }),
      [advance(3000)],
    )
    expect(typesOf(frozen.events, 'ACTION_STARTED').some(e => e.combatantId === 'ally-0')).toBe(true)
  })
})

// ── Confusion ───────────────────────────────────────────────────────────────

describe('confusion', () => {
  const ALWAYS_SELF_HIT: BattleRulesConfig = {
    ...NO_CRITS,
    confusion: { ...NO_CRITS.confusion, selfHitChance: 1 },
  }

  it('sits beside a major status, hurts its owner and expires on the clock', async () => {
    const battle = await buildSampleBattle(SLOW)
    const confused = patch(withConfig(battle.state, ALWAYS_SELF_HIT), 'ally-0', {
      condition: { majorStatus: 'burn' },
      runtime: { confusionRemainingMs: 8000 },
    })
    const result = play(battle, confused, ticks(48))
    expect(typesOf(result.events, 'CONFUSION_SELF_HIT').length).toBeGreaterThan(0)
    const ended = typesOf(result.events, 'CONFUSION_ENDED').find(e => e.combatantId === 'ally-0')
    expect(ended?.atMs).toBe(8000)
    // The burn is still there: confusion never took the major-status slot.
    expect(result.state.combatants['ally-0'].condition.majorStatus).toBe('burn')
    // And it is gone from the runtime.
    expect(result.state.combatants['ally-0'].runtime.confusionRemainingMs).toBe(0)
  })

  it('spends the Action Window on the self-hit instead of the move', async () => {
    const battle = await buildSampleBattle(SLOW)
    const confused = patch(withConfig(battle.state, ALWAYS_SELF_HIT), 'ally-0', {
      runtime: { confusionRemainingMs: 8000 },
    })
    const result = play(battle, confused, [advance(4000)])
    expect(typesOf(result.events, 'CONFUSION_SELF_HIT')).toHaveLength(1)
    expect(typesOf(result.events, 'MOVE_USED').filter(e => e.combatantId === 'ally-0')).toHaveLength(0)
  })
})

// ── Switching and fainting ──────────────────────────────────────────────────

describe('switching', () => {
  const WITH_BENCH: SampleBattleInput = {
    ...DUEL,
    battleId: 'switch',
    bench: [{ speciesId: 6, level: 50, moves: ['flamethrower'] }],
  }

  it('costs an Action Window, keeps the condition and drops the runtime', async () => {
    const battle = await buildSampleBattle(WITH_BENCH)
    const start = patch(withConfig(battle.state, NO_CRITS), 'ally-0', {
      condition: { currentHp: 40, majorStatus: 'burn' },
      runtime: { stages: { atk: 2 }, confusionRemainingMs: 5000, protectCharges: 2 },
    })
    const result = play(battle, start, [
      { type: 'SWITCH', combatantId: 'ally-0', incomingId: 'ally-1' },
      ...ticks(10),
    ])
    const switched = typesOf(result.events, 'SWITCHED')[0]
    expect(switched).toMatchObject({ sideId: 'ally', outgoingId: 'ally-0', incomingId: 'ally-1' })
    expect(switched.atMs).toBeGreaterThan(0)

    const outgoing = result.state.combatants['ally-0']
    expect(outgoing.condition.currentHp).toBe(40)
    expect(outgoing.condition.majorStatus).toBe('burn')
    expect(outgoing.runtime.stages).toEqual({})
    expect(outgoing.runtime.confusionRemainingMs).toBe(0)
    expect(outgoing.runtime.protectCharges).toBe(0)
    expect(result.state.sides.find(side => side.sideId === 'ally')?.activeIds).toEqual(['ally-1'])
  })

  it('brings the incoming Pokémon in with its own wear and a bar at zero', async () => {
    const battle = await buildSampleBattle(WITH_BENCH)
    const start = patch(withConfig(battle.state, NO_CRITS), 'ally-1', {
      condition: { currentHp: 55, majorStatus: 'paralysis' },
    })
    const result = play(battle, start, [
      { type: 'SWITCH', combatantId: 'ally-0', incomingId: 'ally-1' },
      advance(2000),
    ])
    const incoming = result.state.combatants['ally-1']
    expect(incoming.condition.currentHp).toBe(55)
    expect(incoming.condition.majorStatus).toBe('paralysis')
    expect(typesOf(result.events, 'ACTION_STARTED').filter(e => e.combatantId === 'ally-1')).toHaveLength(0)
  })

  it('replaces a fainted Pokémon straight away, without waiting for a bar', async () => {
    const battle = await buildSampleBattle(WITH_BENCH)
    const down = patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { currentHp: 0 } })
    const result = play(battle, down, [{ type: 'SWITCH', combatantId: 'ally-0', incomingId: 'ally-1' }])
    expect(typesOf(result.events, 'SWITCHED')).toHaveLength(1)
    expect(result.state.timeMs).toBe(0)
  })

  it('refuses to send in a fainted Pokémon', async () => {
    const battle = await buildSampleBattle(WITH_BENCH)
    const down = patch(battle.state, 'ally-1', { condition: { currentHp: 0 } })
    const result = reduceBattle(
      down, { type: 'SWITCH', combatantId: 'ally-0', incomingId: 'ally-1' }, battle.context,
    )
    expect(result.state).toBe(down)
    expect(result.events[0]).toMatchObject({ type: 'COMMAND_REJECTED' })
  })
})

describe('fainting and the end of a battle', () => {
  it('ends when one side has nobody left, and says who won', async () => {
    const battle = await buildSampleBattle(DUEL)
    const nearlyDead = patch(withConfig(battle.state, NO_CRITS), 'enemy-0', { condition: { currentHp: 1 } })
    const result = play(battle, nearlyDead, ticks(20))
    expect(typesOf(result.events, 'FAINTED').map(e => e.combatantId)).toContain('enemy-0')
    expect(result.state.outcome).toEqual({ kind: 'decided', winningSideId: 'ally' })
    expect(typesOf(result.events, 'BATTLE_ENDED')).toHaveLength(1)
  })

  it('keeps a side alive while it still has a bench', async () => {
    const battle = await buildSampleBattle({
      ...DUEL, battleId: 'bench', bench: [{ speciesId: 6, level: 50, moves: ['flamethrower'] }],
    })
    const down = patch(withConfig(battle.state, NO_CRITS), 'ally-0', { condition: { currentHp: 0 } })
    const result = play(battle, down, ticks(8))
    expect(result.state.outcome.kind).toBe('ongoing')
    expect(typesOf(result.events, 'ACTION_STARTED').filter(e => e.combatantId === 'ally-0')).toHaveLength(0)
  })

  it('refuses every command once the battle is over', async () => {
    const battle = await buildSampleBattle(DUEL)
    const nearlyDead = patch(withConfig(battle.state, NO_CRITS), 'enemy-0', { condition: { currentHp: 1 } })
    const ended = play(battle, nearlyDead, ticks(20)).state
    expect(ended.outcome.kind).not.toBe('ongoing')
    const after = reduceBattle(
      ended, { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('thunderbolt') }, battle.context,
    )
    expect(after.state).toBe(ended)
    expect(after.events[0].type).toBe('COMMAND_REJECTED')
  })
})

// ── Items and capture ───────────────────────────────────────────────────────

describe('the item contract', () => {
  it('heals, restores PP and revives, and spends an Action Window doing it', async () => {
    const battle = await buildSampleBattle({
      ...DUEL, battleId: 'items', bench: [{ speciesId: 6, level: 50, moves: ['flamethrower'] }],
    })
    const hurt = patch(
      patch(withConfig(battle.state, NO_CRITS), 'ally-0', {
        condition: { currentHp: 10, pp: { [battle.moveId('thunderbolt')]: 0 } },
      }),
      'ally-1', { condition: { currentHp: 0 } },
    )

    const healed = play(battle, hurt, [
      { type: 'USE_ITEM', combatantId: 'ally-0', targetId: 'ally-0', item: { kind: 'healHp', amount: 20 } },
      ...ticks(10),
    ])
    const healEvent = typesOf(healed.events, 'HEAL').find(e => e.cause === 'item')
    expect(healEvent?.amount).toBe(20)
    expect(typesOf(healed.events, 'ITEM_USED')[0].worked).toBe(true)

    const ethered = play(battle, hurt, [
      {
        type: 'USE_ITEM', combatantId: 'ally-0', targetId: 'ally-0',
        item: { kind: 'restorePp', moveId: battle.moveId('thunderbolt'), amount: 5 },
      },
      ...ticks(10),
    ])
    expect(typesOf(ethered.events, 'PP_CHANGED')[0]).toMatchObject({ remaining: 5, max: 15 })

    const revived = play(battle, hurt, [
      { type: 'USE_ITEM', combatantId: 'ally-0', targetId: 'ally-1', item: { kind: 'revive', hpFraction: 0.5 } },
      ...ticks(10),
    ])
    expect(isCombatantFainted(revived.state.combatants['ally-1'])).toBe(false)
    expect(currentHpOf(revived.state.combatants['ally-1']))
      .toBe(Math.floor(battle.state.combatants['ally-1'].stats.hp / 2))
  })

  it('will not use an item on the other side', async () => {
    const battle = await buildSampleBattle(DUEL)
    const result = reduceBattle(
      battle.state,
      { type: 'USE_ITEM', combatantId: 'ally-0', targetId: 'enemy-0', item: { kind: 'healHp', amount: 20 } },
      battle.context,
    )
    expect(result.state).toBe(battle.state)
  })
})

describe('the capture contract', () => {
  const ALWAYS: BattleRulesConfig = {
    ...DEFAULT_BATTLE_RULES_CONFIG,
    capture: { ...DEFAULT_BATTLE_RULES_CONFIG.capture, minChance: 1, maxChance: 1 },
  }
  const NEVER: BattleRulesConfig = {
    ...DEFAULT_BATTLE_RULES_CONFIG,
    capture: { ...DEFAULT_BATTLE_RULES_CONFIG.capture, minChance: 0, maxChance: 0 },
  }

  it('ends the battle as a capture, and says nothing about ownership', async () => {
    const battle = await buildSampleBattle(DUEL)
    const result = play(battle, withConfig(battle.state, ALWAYS), [
      { type: 'CAPTURE', combatantId: 'ally-0', targetId: 'enemy-0', ball: { id: 'poke-ball', bonus: 1 } },
      ...ticks(10),
    ])
    expect(typesOf(result.events, 'CAPTURE_ATTEMPT')).toHaveLength(1)
    expect(typesOf(result.events, 'CAPTURE_SUCCESS')).toHaveLength(1)
    expect(result.state.outcome).toEqual({ kind: 'captured', combatantId: 'enemy-0' })
    // Nothing changed hands: the instance is untouched, and I-1 lives elsewhere.
    expect(result.state.combatants['enemy-0'].instance.ownership.ownerId).toBeNull()
  })

  it('fails without ending the battle, and the throw still cost a window', async () => {
    const battle = await buildSampleBattle(DUEL)
    const result = play(battle, withConfig(battle.state, NEVER), [
      { type: 'CAPTURE', combatantId: 'ally-0', targetId: 'enemy-0', ball: { id: 'poke-ball', bonus: 1 } },
      ...ticks(8),
    ])
    expect(typesOf(result.events, 'CAPTURE_FAILED')).toHaveLength(1)
    expect(result.state.outcome.kind).toBe('ongoing')
  })

  it('refuses to throw a ball at something that is not wild', async () => {
    const battle = await buildSampleBattle({
      ...DUEL, battleId: 'not-wild', enemy: { ...DUEL.enemy, wild: false },
    })
    const result = reduceBattle(
      battle.state,
      { type: 'CAPTURE', combatantId: 'ally-0', targetId: 'enemy-0', ball: { id: 'poke-ball', bonus: 1 } },
      battle.context,
    )
    expect(result.state).toBe(battle.state)
  })
})

// ── Targeting and the way out ───────────────────────────────────────────────

describe('targeting', () => {
  it('never hits its own side', async () => {
    const battle = await buildSampleBattle({
      ...DUEL, battleId: 'targeting', bench: [{ speciesId: 6, level: 50, moves: ['flamethrower'] }],
    })
    const result = play(battle, withConfig(battle.state, NO_CRITS), ticks(40))
    for (const event of typesOf(result.events, 'DAMAGE')) {
      if (event.cause !== 'move' || !event.sourceId) continue
      const source = result.state.combatants[event.sourceId]
      const victim = result.state.combatants[event.combatantId]
      expect(source.sideId).not.toBe(victim.sideId)
    }
  })
})

describe('leaving the battle', () => {
  it('takes the wear out and leaves everything else behind', async () => {
    const battle = await buildSampleBattle(CHARIZARD_VS_AZUMARILL)
    const start = patch(withConfig(battle.state, NO_CRITS), 'ally-0', {
      runtime: { stages: { atk: 2 }, confusionRemainingMs: 4000, protectCharges: 2, activeFormId: 9999 },
    })
    const result = play(battle, start, ticks(20))
    const after = finishBattle(result.state)

    const combatant = result.state.combatants['ally-0']
    const instance = after['ally-0']
    expect(instance.condition).toEqual(combatant.condition)
    expect(instance.formId).toBe(battle.state.combatants['ally-0'].instance.formId)
    // Identity never moved.
    expect(instance.experience).toBe(battle.state.combatants['ally-0'].instance.experience)
    expect(instance.ivs).toEqual(battle.state.combatants['ally-0'].instance.ivs)
    expect(instance.moves).toEqual(battle.state.combatants['ally-0'].instance.moves)
    // And nothing of the runtime survives: there is nowhere for it to go.
    expect(Object.keys(instance)).not.toContain('stages')
    expect(Object.keys(instance)).not.toContain('actionElapsedMs')
  })
})

describe('the sample fixtures', () => {
  it('play a whole battle to a decision', async () => {
    for (const input of [PIKACHU_VS_GENGAR, CHARIZARD_VS_AZUMARILL]) {
      const battle = await buildSampleBattle(input)
      const result = play(battle, battle.state, [
        { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId(input.ally.moves[0]) },
        ...ticks(80),
      ])
      expect(result.state.outcome.kind, input.battleId).toBe('decided')
      expect(result.events.length).toBeGreaterThan(10)
    }
  })
})
