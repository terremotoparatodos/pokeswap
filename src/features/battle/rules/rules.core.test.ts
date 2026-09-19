// The pieces of the rules, tested apart from a battle (R32.3).
//
// Everything here is a pure function over the real catalog: the type chart,
// the Action Bar, the damage chain, the move classification, the capture
// contract and the injected RNG. The engine that strings them together is
// `rules.engine.test.ts`, and determinism is `rules.determinism.test.ts`.

import { describe, expect, it } from 'vitest'
import { loadBattleCatalog } from '../catalog'
import { createBattleRulesCatalog } from './catalogView'
import { DEFAULT_BATTLE_RULES_CONFIG as CONFIG } from './config'
import { baseCooldownMs, cooldownAfterMove, cooldownMs } from './actionBar'
import { computeDamage, critChance, rollAccuracy, rollHitCount } from './damage'
import { captureChance, resolveCapture } from './capture'
import { classifyMove, reportMoveCoverage } from './moveSupport'
import { createRngState, drawChance, drawInt, drawRandom, rngValueAt } from './rng'
import { applyStage, clampStage, stageMultiplier } from './stats'
import { buildSampleBattle, PIKACHU_VS_GENGAR } from './sampleBattles'
import type { BattleCombatant } from './state'

const catalogPromise = loadBattleCatalog().then(createBattleRulesCatalog)

describe('injected randomness', () => {
  it('is a pure function of seed and cursor', () => {
    expect(rngValueAt(7, 0)).toBe(rngValueAt(7, 0))
    expect(rngValueAt(7, 0)).not.toBe(rngValueAt(7, 1))
    expect(rngValueAt(7, 0)).not.toBe(rngValueAt(8, 0))
  })

  it('never mutates the state it is given', () => {
    const start = createRngState(42)
    const first = drawRandom(start)
    const second = drawRandom(start)
    expect(start.cursor).toBe(0)
    expect(first.value).toBe(second.value)
    expect(first.rng.cursor).toBe(1)
  })

  it('spends exactly one draw even when the answer is certain', () => {
    const start = createRngState(3)
    expect(drawChance(start, 1).rng.cursor).toBe(1)
    expect(drawChance(start, 0).rng.cursor).toBe(1)
    expect(drawInt(start, 5, 5).rng.cursor).toBe(1)
  })

  it('stays inside its bounds over many draws', () => {
    let rng = createRngState(2026)
    for (let i = 0; i < 2000; i++) {
      const draw = drawRandom(rng)
      expect(draw.value).toBeGreaterThanOrEqual(0)
      expect(draw.value).toBeLessThan(1)
      const int = drawInt(draw.rng, 0, 15)
      expect(int.value).toBeGreaterThanOrEqual(0)
      expect(int.value).toBeLessThanOrEqual(15)
      rng = int.rng
    }
    expect(rng.cursor).toBe(4000)
  })
})

describe('the type chart, read from the catalog', () => {
  it('answers the four fixtures the contract names', async () => {
    const catalog = await catalogPromise
    expect(catalog.effectiveness('fairy', ['dragon'])).toBe(2)
    expect(catalog.effectiveness('dragon', ['fairy'])).toBe(0)
    expect(catalog.effectiveness('ghost', ['normal'])).toBe(0)
    expect(catalog.effectiveness('electric', ['ground'])).toBe(0)
  })

  it('covers every multiplier, including dual typings', async () => {
    const catalog = await catalogPromise
    expect(catalog.effectiveness('fighting', ['poison', 'flying'])).toBe(0.25)
    expect(catalog.effectiveness('fire', ['water'])).toBe(0.5)
    expect(catalog.effectiveness('normal', ['normal'])).toBe(1)
    expect(catalog.effectiveness('water', ['fire'])).toBe(2)
    expect(catalog.effectiveness('fighting', ['rock', 'dark'])).toBe(4)
    // An immunity survives a weakness: Gengar is Ghost/Poison.
    expect(catalog.effectiveness('normal', ['ghost', 'poison'])).toBe(0)
  })

  it('is Generation VI: Steel lost its Ghost and Dark resistances, Fairy exists', async () => {
    const catalog = await catalogPromise
    expect(catalog.effectiveness('ghost', ['steel'])).toBe(1)
    expect(catalog.effectiveness('dark', ['steel'])).toBe(1)
    expect(catalog.effectiveness('steel', ['fairy'])).toBe(2)
  })
})

describe('the Action Bar', () => {
  it('follows clamp(2.6 · sqrt(60 / Speed), 1.4, 4.0)', () => {
    expect(baseCooldownMs(60, CONFIG)).toBe(2600)
    expect(baseCooldownMs(15, CONFIG)).toBe(4000)
    expect(baseCooldownMs(400, CONFIG)).toBe(1400)
    // 2.6 * sqrt(60/120) = 1.838…
    expect(baseCooldownMs(120, CONFIG)).toBe(1838)
  })

  it('is monotonic: more Speed is never slower', () => {
    let previous = Number.POSITIVE_INFINITY
    for (let speed = 1; speed <= 500; speed++) {
      const value = baseCooldownMs(speed, CONFIG)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
  })

  it('re-reads priority and recharge as time, not as turn order', () => {
    expect(cooldownAfterMove(1, false, CONFIG)).toBe(0.5)
    expect(cooldownAfterMove(4, false, CONFIG)).toBe(0.5)
    expect(cooldownAfterMove(0, true, CONFIG)).toBe(2)
    // Recharge wins over priority when a move somehow had both.
    expect(cooldownAfterMove(1, true, CONFIG)).toBe(2)
    expect(cooldownAfterMove(0, false, CONFIG)).toBe(1)
  })

  it('doubles every cooldown while paralysed', async () => {
    const battle = await buildSampleBattle(PIKACHU_VS_GENGAR)
    const pikachu = battle.state.combatants['ally-0']
    const paralysed: BattleCombatant = {
      ...pikachu,
      condition: { ...pikachu.condition, majorStatus: 'paralysis' },
    }
    expect(cooldownMs(paralysed, CONFIG)).toBe(cooldownMs(pikachu, CONFIG) * 2)
  })
})

describe('stat stages', () => {
  it('runs −2…+2 with the classic multipliers inside that range', () => {
    expect(stageMultiplier(-2, CONFIG.statStages)).toBe(0.5)
    expect(stageMultiplier(-1, CONFIG.statStages)).toBeCloseTo(2 / 3, 10)
    expect(stageMultiplier(0, CONFIG.statStages)).toBe(1)
    expect(stageMultiplier(1, CONFIG.statStages)).toBe(1.5)
    expect(stageMultiplier(2, CONFIG.statStages)).toBe(2)
  })

  it('clamps the **stage**, so there is nothing hidden past the ends', () => {
    expect(stageMultiplier(6, CONFIG.statStages)).toBe(2)
    expect(stageMultiplier(-6, CONFIG.statStages)).toBe(0.5)
    expect(clampStage(9, CONFIG.statStages)).toBe(2)
    expect(clampStage(-9, CONFIG.statStages)).toBe(-2)
  })

  /**
   * The bug this replaces: with a −6…+6 ladder under a clamped multiplier,
   * four Swords Dances read ×2 like two do, and then a Growl takes the hidden
   * +6 to +5 and the number on screen does not move. A player cannot learn a
   * rule they cannot see.
   */
  it('has no hidden stacking above the ceiling', () => {
    let stages = {}
    for (let i = 0; i < 4; i++) stages = applyStage(stages, 'atk', 2, CONFIG.statStages).stages
    expect(stages).toEqual({ atk: 2 })
    expect(stageMultiplier(2, CONFIG.statStages)).toBe(2)

    // One debuff, and it is felt immediately.
    const down = applyStage(stages, 'atk', -1, CONFIG.statStages)
    expect(down.stage).toBe(1)
    expect(down.changed).toBe(true)
    expect(stageMultiplier(down.stage, CONFIG.statStages)).toBe(1.5)
  })

  it('has no hidden stacking below the floor either', () => {
    let stages = {}
    for (let i = 0; i < 4; i++) stages = applyStage(stages, 'def', -2, CONFIG.statStages).stages
    expect(stages).toEqual({ def: -2 })

    const up = applyStage(stages, 'def', 1, CONFIG.statStages)
    expect(up.stage).toBe(-1)
    expect(stageMultiplier(up.stage, CONFIG.statStages)).toBeCloseTo(2 / 3, 10)
  })

  it('says when a stage did not move', () => {
    const capped = applyStage({ spe: 2 }, 'spe', 2, CONFIG.statStages)
    expect(capped.changed).toBe(false)
    expect(capped.stage).toBe(2)
    const floored = applyStage({ spe: -2 }, 'spe', -1, CONFIG.statStages)
    expect(floored.changed).toBe(false)
  })
})

describe('damage', () => {
  it('rounds in the documented order and lands in the 85–100 % band', async () => {
    const battle = await buildSampleBattle(PIKACHU_VS_GENGAR)
    const attacker = battle.state.combatants['ally-0']
    const defender = battle.state.combatants['enemy-0']
    const rolls: number[] = []
    for (let cursor = 0; cursor < 200; cursor += 2) {
      const result = computeDamage(
        {
          attacker, defender, power: 90, category: 'special', moveType: 'electric',
          attackerTypes: ['electric'], defenderTypes: ['ghost', 'poison'],
          critStage: 0, appliesTyping: true, effectiveness: 1,
        },
        CONFIG,
        { seed: 1, cursor },
      )
      if (!result.critical) rolls.push(result.damage)
    }
    const min = Math.min(...rolls)
    const max = Math.max(...rolls)
    expect(min).toBeGreaterThan(0)
    // The spread is the 85…100 band and nothing else.
    expect(max / min).toBeLessThanOrEqual(100 / 85 + 0.02)
  })

  it('gives zero against an immunity and never less than one otherwise', async () => {
    const battle = await buildSampleBattle(PIKACHU_VS_GENGAR)
    const attacker = battle.state.combatants['ally-0']
    const defender = battle.state.combatants['enemy-0']
    const immune = computeDamage(
      {
        attacker, defender, power: 40, category: 'physical', moveType: 'normal',
        attackerTypes: ['electric'], defenderTypes: ['ghost', 'poison'],
        critStage: 0, appliesTyping: true, effectiveness: 0,
      },
      CONFIG, createRngState(1),
    )
    expect(immune.damage).toBe(0)

    const weakest = computeDamage(
      {
        attacker, defender, power: 1, category: 'physical', moveType: 'normal',
        attackerTypes: ['electric'], defenderTypes: ['steel'],
        critStage: 0, appliesTyping: true, effectiveness: 0.25,
      },
      CONFIG, createRngState(1),
    )
    expect(weakest.damage).toBeGreaterThanOrEqual(1)
  })

  it('applies STAB only when the attacker shares the move type', async () => {
    const battle = await buildSampleBattle(PIKACHU_VS_GENGAR)
    const attacker = battle.state.combatants['ally-0']
    const defender = battle.state.combatants['enemy-0']
    const base = {
      attacker, defender, power: 90, category: 'special' as const, moveType: 'electric' as const,
      defenderTypes: ['normal'] as const, critStage: 0, appliesTyping: true, effectiveness: 1,
    }
    const withStab = computeDamage({ ...base, attackerTypes: ['electric'] }, CONFIG, createRngState(9))
    const without = computeDamage({ ...base, attackerTypes: ['water'] }, CONFIG, createRngState(9))
    expect(withStab.stab).toBe(1.5)
    expect(without.stab).toBe(1)
    expect(withStab.damage).toBeGreaterThan(without.damage)
  })

  it('ignores typing entirely when the move is Struggle', async () => {
    const battle = await buildSampleBattle(PIKACHU_VS_GENGAR)
    const attacker = battle.state.combatants['ally-0']
    const defender = battle.state.combatants['enemy-0']
    const struggle = computeDamage(
      {
        attacker, defender, power: 50, category: 'physical', moveType: 'normal',
        attackerTypes: ['electric'], defenderTypes: ['ghost', 'poison'],
        critStage: 0, appliesTyping: false, effectiveness: 0,
      },
      CONFIG, createRngState(4),
    )
    expect(struggle.effectiveness).toBe(1)
    expect(struggle.damage).toBeGreaterThan(0)
  })

  it('reads the Gen VI crit table', () => {
    expect(critChance(0, CONFIG)).toBeCloseTo(1 / 16, 10)
    expect(critChance(1, CONFIG)).toBeCloseTo(1 / 8, 10)
    expect(critChance(99, CONFIG)).toBe(1)
  })

  it('never misses with a null accuracy, and still spends the draw', async () => {
    const battle = await buildSampleBattle(PIKACHU_VS_GENGAR)
    const attacker = battle.state.combatants['ally-0']
    const defender = battle.state.combatants['enemy-0']
    for (let cursor = 0; cursor < 50; cursor++) {
      const result = rollAccuracy(null, attacker, defender, CONFIG, { seed: 5, cursor })
      expect(result.hit).toBe(true)
      expect(result.rng.cursor).toBe(cursor + 1)
    }
  })

  it('gives 2–5 hits the Gen VI distribution', () => {
    const counts: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 }
    for (let cursor = 0; cursor < 8000; cursor++) {
      counts[rollHitCount(2, 5, { seed: 11, cursor }).hits] += 1
    }
    expect(counts[2] / 8000).toBeCloseTo(0.375, 1)
    expect(counts[3] / 8000).toBeCloseTo(0.375, 1)
    expect(counts[4] / 8000).toBeCloseTo(0.125, 1)
    expect(counts[5] / 8000).toBeCloseTo(0.125, 1)
  })
})

describe('the move effect registry', () => {
  it('resolves behaviour by effectId and never by move id', async () => {
    const catalog = await catalogPromise
    const expectations: readonly [string, string][] = [
      ['tackle', 'damage'],
      ['double-slap', 'damage.multiHit'],
      ['giga-drain', 'damage.drain'],
      ['double-edge', 'damage.recoil'],
      ['hyper-beam', 'damage.recharge'],
      ['flamethrower', 'damage.ailment'],
      ['thunder-wave', 'ailment'],
      ['recover', 'heal'],
      ['protect', 'protect'],
      ['swords-dance', 'statChange'],
      ['growl', 'statChange'],
      ['shadow-ball', 'damage.statChange'],
    ]
    for (const [name, effect] of expectations) {
      const move = catalog.moveNamed(name)
      expect(move, name).not.toBeNull()
      expect(classifyMove(move!), name).toEqual({ kind: 'executable', effect })
    }
  })

  it('defers what it cannot run, with a reason and never a silent fallback', async () => {
    const catalog = await catalogPromise
    const deferred: readonly [string, string][] = [
      ['growth', 'stat change not stated by the pinned sources'],
      ['defense-curl', 'stat change not stated by the pinned sources'],
      ['solar-beam', 'charge turn'],
      ['fissure', 'effect ohko'],
      ['whirlwind', 'effect forceSwitch'],
      ['explosion', 'effect damage.selfKo'],
      ['sunny-day', 'target entire-field'],
      ['rest', 'effect unique'],
      ['reflect', 'target users-field'],
      ['seismic-toss', 'variable power'],
      ['waterfall', 'flinch has no realtime meaning yet'],
    ]
    for (const [name, reason] of deferred) {
      const move = catalog.moveNamed(name)
      expect(move, name).not.toBeNull()
      expect(classifyMove(move!), name).toEqual({ kind: 'deferred', reason })
    }
  })

  it('reports the coverage of the whole catalog, and the numbers add up', async () => {
    const catalog = await catalogPromise
    const report = reportMoveCoverage(catalog.allMoves())
    expect(report.total).toBe(621)
    expect(report.executable + report.deferred).toBe(report.total)
    expect(report.executable).toBe(390)
    expect(report.byReason.reduce((sum, row) => sum + row.moves, 0)).toBe(report.deferred)
    // What used to be the biggest bucket — 118 moves whose stat change the
    // catalog could not state — is down to the handful the pinned sources
    // genuinely do not settle.
    expect(report.byReason[0]).toEqual({ reason: 'effect unique', moves: 78 })
    expect(report.byReason.find(row => row.reason === 'stat change not stated by the pinned sources'))
      .toEqual({ reason: 'stat change not stated by the pinned sources', moves: 10 })
  })

  it('states every stat change it claims to run, fully', async () => {
    const catalog = await catalogPromise
    const stageable = new Set(['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'])
    for (const move of catalog.allMoves()) {
      const verdict = classifyMove(move)
      if (verdict.kind !== 'executable') continue
      if (verdict.effect !== 'statChange' && verdict.effect !== 'damage.statChange') continue

      const spec = move.meta.statChanges
      expect(spec, move.name).not.toBeNull()
      expect(['user', 'target']).toContain(spec!.recipient)
      expect(spec!.chance).toBeGreaterThan(0)
      expect(spec!.chance).toBeLessThanOrEqual(100)
      expect(spec!.changes.length).toBeGreaterThan(0)
      for (const change of spec!.changes) {
        expect(stageable.has(change.stat), `${move.name}: ${change.stat}`).toBe(true)
        expect(change.stages).not.toBe(0)
      }
      // A pure stat move is never a chance; a secondary always is.
      if (verdict.effect === 'statChange') expect(spec!.kind).toBe('direct')
    }
  })

  it('reads the recipient from the sources, not from the sign of the number', async () => {
    const catalog = await catalogPromise
    const expected: readonly [string, 'user' | 'target', number, string, number][] = [
      ['swords-dance', 'user', 100, 'atk', 2],
      ['growl', 'target', 100, 'atk', -1],
      ['tail-whip', 'target', 100, 'def', -1],
      ['agility', 'user', 100, 'spe', 2],
      ['screech', 'target', 100, 'def', -2],
      ['sand-attack', 'target', 100, 'accuracy', -1],
      ['double-team', 'user', 100, 'evasion', 1],
      // A self-inflicted drop: the sign says "down" and the recipient is still
      // the user, which is exactly what a sign cannot tell you.
      ['overheat', 'user', 100, 'spa', -2],
      ['charge-beam', 'user', 70, 'spa', 1],
      ['shadow-ball', 'target', 20, 'spd', -1],
    ]
    for (const [name, recipient, chance, stat, stages] of expected) {
      const move = catalog.moveNamed(name)
      expect(move, name).not.toBeNull()
      expect(move!.meta.statChanges, name).toMatchObject({ recipient, chance })
      expect(move!.meta.statChanges!.changes, name).toContainEqual({ stat, stages })
    }
  })

  it('takes the Gen VI diff over the tabular row when they disagree', async () => {
    const catalog = await catalogPromise
    // The tabular stat-change table is present-day and `move_changelog.csv`
    // does not roll it back: it says Diamond Storm raises Defence by two, and
    // Generation VI is one. The pinned Gen VI diff settles it.
    const move = catalog.moveNamed('diamond-storm')
    expect(move!.meta.statChanges).toEqual({
      recipient: 'user',
      chance: 50,
      kind: 'secondary',
      changes: [{ stat: 'def', stages: 1 }],
      source: 'gen6-diff',
    })
  })
})

describe('the capture contract', () => {
  const input = {
    catchRate: 45, currentHp: 100, maxHp: 100, majorStatus: 'none',
    ball: { id: 'poke-ball', bonus: 1 },
  }

  it('reacts to health, status and ball, and stays inside its band', () => {
    const healthy = captureChance(input, CONFIG)
    const hurt = captureChance({ ...input, currentHp: 5 }, CONFIG)
    const asleep = captureChance({ ...input, currentHp: 5, majorStatus: 'sleep' }, CONFIG)
    const better = captureChance({ ...input, currentHp: 5, ball: { id: 'ultra', bonus: 2 } }, CONFIG)
    expect(hurt).toBeGreaterThan(healthy)
    expect(asleep).toBeGreaterThan(hurt)
    expect(better).toBeGreaterThan(hurt)
    expect(healthy).toBeGreaterThanOrEqual(CONFIG.capture.minChance)
    expect(asleep).toBeLessThanOrEqual(CONFIG.capture.maxChance)
  })

  it('cannot catch a fainted target', () => {
    expect(captureChance({ ...input, currentHp: 0 }, CONFIG)).toBe(0)
  })

  it('is decided by the injected roll and spends exactly one draw', () => {
    const first = resolveCapture(input, CONFIG, createRngState(1))
    const again = resolveCapture(input, CONFIG, createRngState(1))
    expect(first.captured).toBe(again.captured)
    expect(first.rng.cursor).toBe(1)
    expect(first.shakes).toBeGreaterThanOrEqual(0)
    expect(first.shakes).toBeLessThanOrEqual(3)
  })
})
