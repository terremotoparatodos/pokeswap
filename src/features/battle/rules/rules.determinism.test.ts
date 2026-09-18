// The gate for R32.4 (R32.3).
//
// Everything R32.4 is going to build assumes one thing: that a server and a
// client running the same module over the same inputs end up in the same
// place. That claim is checked here, and it is checked on **events** as well
// as on the final state — two runs that ended the same way having told
// different stories are not the same battle, and a HUD fed by the loser's
// stream would drift.
//
// The invariants are here too, run over long soak battles rather than asserted
// on a handful of hand-made states: HP inside its range, PP inside its range,
// at most one major status, fainted exactly when there is no HP left.

import { describe, expect, it } from 'vitest'
import type { BattleCommand } from './commands'
import type { BattleEvent } from './events'
import { reduceBattle } from './reduce'
import { finishBattle } from './setup'
import { isCombatantFainted } from './state'
import type { BattleState } from './state'
import { maxPPOf } from '../../pokemon/model'
import { buildSampleBattle, CHARIZARD_VS_AZUMARILL, PIKACHU_VS_GENGAR } from './sampleBattles'
import type { SampleBattle, SampleBattleInput } from './sampleBattles'

interface Run {
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

function play(battle: SampleBattle, state: BattleState, commands: readonly BattleCommand[]): Run {
  let current = state
  const events: BattleEvent[] = []
  for (const command of commands) {
    const step = reduceBattle(current, command, battle.context)
    current = step.state
    events.push(...step.events)
  }
  return { state: current, events }
}

/** A long script that touches most of the engine: moves, items, switches, time. */
function script(battle: SampleBattle): BattleCommand[] {
  const commands: BattleCommand[] = [
    { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('thunderbolt') },
  ]
  for (let i = 0; i < 20; i++) commands.push({ type: 'ADVANCE_TIME', deltaMs: 250 })
  commands.push({
    type: 'USE_ITEM', combatantId: 'ally-0', targetId: 'ally-0', item: { kind: 'healHp', amount: 25 },
  })
  for (let i = 0; i < 20; i++) commands.push({ type: 'ADVANCE_TIME', deltaMs: 250 })
  commands.push({ type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId('double-slap') })
  for (let i = 0; i < 40; i++) commands.push({ type: 'ADVANCE_TIME', deltaMs: 250 })
  return commands
}

const SOAK: SampleBattleInput = {
  battleId: 'soak', seed: 777,
  ally: { speciesId: 25, level: 50, moves: ['thunderbolt', 'double-slap', 'thunder-wave', 'quick-attack'] },
  enemy: { speciesId: 143, level: 50, wild: true, moves: ['body-slam', 'toxic', 'fury-swipes', 'protect'] },
  bench: [{ speciesId: 6, level: 50, moves: ['flamethrower', 'double-edge', 'giga-drain', 'protect'] }],
}

describe('deterministic replay', () => {
  it('gives the same state and the same events, run after run', async () => {
    const reference = await buildSampleBattle(SOAK)
    const expected = play(reference, reference.state, script(reference))
    for (let attempt = 0; attempt < 5; attempt++) {
      const battle = await buildSampleBattle(SOAK)
      const run = play(battle, battle.state, script(battle))
      expect(JSON.stringify(run.state), `state, attempt ${attempt}`).toBe(JSON.stringify(expected.state))
      expect(JSON.stringify(run.events), `events, attempt ${attempt}`).toBe(JSON.stringify(expected.events))
    }
  })

  it('depends on the seed: a different one is a different battle', async () => {
    const first = await buildSampleBattle(SOAK)
    const second = await buildSampleBattle({ ...SOAK, seed: SOAK.seed + 1 })
    const a = play(first, first.state, script(first))
    const b = play(second, second.state, script(second))
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events))
  })

  it('does not depend on how the caller slices the clock', async () => {
    const reference = await buildSampleBattle(SOAK)
    const select: BattleCommand = {
      type: 'USE_MOVE', combatantId: 'ally-0', moveId: reference.moveId('thunderbolt'),
    }
    const fine = play(reference, reference.state, [
      select, ...Array.from({ length: 1000 }, () => ({ type: 'ADVANCE_TIME', deltaMs: 10 }) as BattleCommand),
    ])
    for (const deltaMs of [1, 17, 250, 1000, 10000]) {
      const battle = await buildSampleBattle(SOAK)
      // The same ten seconds, cut differently — including a ragged frame time
      // that does not divide them, with the remainder as a last slice.
      const slices = Math.floor(10000 / deltaMs)
      const remainder = 10000 - slices * deltaMs
      const run = play(battle, battle.state, [
        select,
        ...Array.from({ length: slices }, () => ({ type: 'ADVANCE_TIME', deltaMs }) as BattleCommand),
        ...(remainder > 0 ? [{ type: 'ADVANCE_TIME', deltaMs: remainder } as BattleCommand] : []),
      ])
      expect(JSON.stringify(run.state.combatants), `slices of ${deltaMs} ms`)
        .toBe(JSON.stringify(fine.state.combatants))
      expect(JSON.stringify(run.events), `events at ${deltaMs} ms`).toBe(JSON.stringify(fine.events))
    }
  })

  it('survives a round trip through JSON, mid-battle', async () => {
    const battle = await buildSampleBattle(SOAK)
    const half = script(battle)
    const first = play(battle, battle.state, half.slice(0, 20))
    const serialised = JSON.parse(JSON.stringify(first.state)) as BattleState
    expect(serialised).toEqual(first.state)

    const straight = play(battle, first.state, half.slice(20))
    const viaJson = play(battle, serialised, half.slice(20))
    expect(JSON.stringify(viaJson.state)).toBe(JSON.stringify(straight.state))
    expect(JSON.stringify(viaJson.events)).toBe(JSON.stringify(straight.events))
  })

  it('never reads a real clock or a real random source', async () => {
    const battle = await buildSampleBattle(SOAK)
    const random = Math.random
    const now = Date.now
    Math.random = () => { throw new Error('the rules called Math.random()') }
    Date.now = () => { throw new Error('the rules read the wall clock') }
    try {
      const run = play(battle, battle.state, script(battle))
      expect(run.events.length).toBeGreaterThan(10)
    } finally {
      Math.random = random
      Date.now = now
    }
  })
})

describe('invariants, over long battles', () => {
  const fixtures: readonly SampleBattleInput[] = [SOAK, PIKACHU_VS_GENGAR, CHARIZARD_VS_AZUMARILL]

  it('holds HP, PP, status and faint inside their contracts all the way through', async () => {
    for (const fixture of fixtures) {
      const battle = await buildSampleBattle(fixture)
      let state = battle.state
      let lastSeq = -1
      let lastTime = -1

      for (let step = 0; step < 200; step++) {
        const result = reduceBattle(state, { type: 'ADVANCE_TIME', deltaMs: 100 }, battle.context)
        state = result.state

        for (const event of result.events) {
          expect(event.seq, fixture.battleId).toBeGreaterThan(lastSeq)
          lastSeq = event.seq
          expect(event.atMs).toBeGreaterThanOrEqual(0)
        }
        expect(state.timeMs).toBeGreaterThanOrEqual(lastTime)
        lastTime = state.timeMs

        for (const combatant of Object.values(state.combatants)) {
          const hp = combatant.condition.currentHp
          if (hp !== null) {
            expect(hp, `${fixture.battleId} HP`).toBeGreaterThanOrEqual(0)
            expect(hp).toBeLessThanOrEqual(combatant.stats.hp)
            expect(Number.isInteger(hp)).toBe(true)
          }
          // Faint is derived from HP and cannot disagree with it.
          expect(isCombatantFainted(combatant)).toBe(hp === 0)

          for (const [key, value] of Object.entries(combatant.condition.pp)) {
            const slot = combatant.instance.moves.find(entry => entry.moveId === Number(key))
            expect(slot, `${fixture.battleId} knows move ${key}`).toBeDefined()
            const move = battle.catalog.move(Number(key))!
            expect(value).toBeGreaterThanOrEqual(0)
            expect(value).toBeLessThanOrEqual(maxPPOf(move.pp, slot!.ppUps))
          }

          // One major status at a time: it is a single field, and confusion is
          // not one of its values.
          expect(combatant.condition.majorStatus).not.toBe('confusion')
          expect(combatant.runtime.protectCharges).toBeGreaterThanOrEqual(0)
          expect(combatant.runtime.confusionRemainingMs).toBeGreaterThanOrEqual(0)
          expect(combatant.runtime.actionElapsedMs).toBeGreaterThanOrEqual(0)
        }
        if (state.outcome.kind !== 'ongoing') break
      }
    }
  })

  it('takes only the wear out, whatever happened in the fight', async () => {
    const battle = await buildSampleBattle(SOAK)
    const run = play(battle, battle.state, script(battle))
    const after = finishBattle(run.state)
    for (const [combatantId, instance] of Object.entries(after)) {
      const before = battle.state.combatants[combatantId].instance
      const now = run.state.combatants[combatantId]
      // Identity untouched…
      expect(instance.speciesId).toBe(before.speciesId)
      expect(instance.formId).toBe(before.formId)
      expect(instance.experience).toBe(before.experience)
      expect(instance.natureId).toBe(before.natureId)
      expect(instance.abilityId).toBe(before.abilityId)
      expect(instance.ivs).toEqual(before.ivs)
      expect(instance.evs).toEqual(before.evs)
      expect(instance.moves).toEqual(before.moves)
      expect(instance.ownership).toEqual(before.ownership)
      // …wear carried out…
      expect(instance.condition.currentHp).toBe(now.condition.currentHp)
      expect(instance.condition.majorStatus).toBe(now.condition.majorStatus)
      // …and the record is still plain data.
      expect(JSON.parse(JSON.stringify(instance))).toEqual(instance)
    }
  })

  it('leaves a refused command with nothing to show for it', async () => {
    const battle = await buildSampleBattle(SOAK)
    const midway = play(battle, battle.state, script(battle).slice(0, 25)).state
    const before = JSON.stringify(midway)
    const refused = reduceBattle(
      midway, { type: 'USE_MOVE', combatantId: 'ally-0', moveId: 999999 }, battle.context,
    )
    expect(refused.state).toBe(midway)
    expect(JSON.stringify(midway)).toBe(before)
  })
})
