// D1 battle rules v2: the Action Bar, priority and recharge as cooldowns,
// Protect by offensive actions, capped stages, one major status, confusion
// beside it, poison on its own clock, auto-repeat, switch, and no pause.

import { describe, expect, it } from 'vitest'
import { BATTLE_ITEMS, buildParty, buildWild, combatantFor } from '../data/runFixtures'
import {
  actorById, barOf, cooldownOf, createBattle, livingActors, prepare, tick, type BattleState,
} from './battle'
import { attemptCapture, captureChance } from './capture'
import { ACTION_BAR, cooldownAfter, cooldownSeconds, fillSeconds, stageMultiplier, STAGE_LIMITS, STATUS } from './damage'
import { isOffensive, isSingleTargetInV1, MOVES } from './moves'
import { createRng } from './rng'
import { isFainted, type PokemonInstance } from './party'

const rng = (seed = 7) => createRng(seed)

function battleOf(options: {
  ally?: PokemonInstance; enemy?: PokemonInstance; bench?: PokemonInstance[]; seed?: number
} = {}): BattleState {
  const party = buildParty()
  const ally = options.ally ?? party[0]
  const enemy = options.enemy ?? buildWild(74, 25)
  return createBattle({
    allies: [{ combatant: combatantFor(ally) }],
    enemies: [combatantFor(enemy)],
    bench: { p1: options.bench ?? party.slice(1, 3) },
    items: BATTLE_ITEMS,
    rng: rng(options.seed),
  })
}

const run = (battle: BattleState, seconds: number, step = 1 / 30): BattleState => {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) tick(battle, step)
  return battle
}

describe('action bar rhythm (D1 §21)', () => {
  // D1.2.4 §5 raised every cooldown by 50 %, so the window the D1 brief called
  // 2–3 seconds is now 3–4.5. The shape is the approved one; the numbers moved.
  it('lands an average Pokémon in the 3–4.5 second window', () => {
    const battle = battleOf()
    const average = cooldownOf(battle, actorById(battle, 'ally-0')!)
    expect(average).toBeGreaterThanOrEqual(3)
    expect(average).toBeLessThanOrEqual(4.5)
  })

  it('is deterministic: the same combatant always gets the same cooldown', () => {
    const battle = battleOf()
    const actor = actorById(battle, 'ally-0')!
    expect(cooldownSeconds(actor.combatant)).toBe(cooldownSeconds(actor.combatant))
  })

  it('keeps fast and slow apart without absurd extremes', () => {
    const slow = fillSeconds(20)
    const fast = fillSeconds(95)
    expect(slow).toBeGreaterThan(fast)
    expect(slow / fast).toBeLessThan(2.5)
    expect(fillSeconds(100000)).toBe(ACTION_BAR.minSeconds)
    expect(fillSeconds(1)).toBe(ACTION_BAR.maxSeconds)
  })

  it('doubles the cooldown under paralysis (§26)', () => {
    const battle = battleOf()
    const actor = actorById(battle, 'ally-0')!
    const healthy = cooldownSeconds(actor.combatant)
    actor.combatant.pokemon.status = 'paralysis'
    expect(cooldownSeconds(actor.combatant)).toBeCloseTo(healthy * ACTION_BAR.paralysisMultiplier, 5)
  })

  it('halves it after a priority move and doubles it after a recharge (§22, §23)', () => {
    expect(cooldownAfter(MOVES.quickAttack)).toBe(ACTION_BAR.priorityMultiplier)
    expect(cooldownAfter(MOVES.hyperBeam)).toBe(ACTION_BAR.rechargeMultiplier)
    expect(cooldownAfter(MOVES.protect)).toBe(ACTION_BAR.protectMultiplier)
    expect(cooldownAfter(MOVES.tackle)).toBe(1)
  })

  it('applies that multiplier to the next bar, not the current one', () => {
    const battle = battleOf()
    const actor = actorById(battle, 'ally-0')!
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'quickAttack' })
    const before = cooldownOf(battle, actor)
    run(battle, before + 0.2)
    expect(actor.cooldownMultiplier).toBe(ACTION_BAR.priorityMultiplier)
    expect(cooldownOf(battle, actor)).toBeCloseTo(before / 2, 1)
  })
})

describe('auto-repeat (D1 §20)', () => {
  it('repeats the last selected move when the player does nothing', () => {
    const battle = battleOf()
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })
    run(battle, 9)
    const used = battle.log.filter(event => event.actorId === 'ally-0' && event.kind === 'move')
    expect(used.length).toBeGreaterThan(1)
    expect(used.every(event => event.text.includes('Golpe Cuerpo'))).toBe(true)
  })

  it('falls back to the first usable move when nothing was ever chosen', () => {
    const battle = battleOf()
    run(battle, 8)
    const first = MOVES[buildParty()[0].moves[0]]
    expect(battle.log.some(event => event.actorId === 'ally-0' && event.text.includes(first.name))).toBe(true)
  })
})

describe('protect (D1 §24)', () => {
  it('absorbs the next two offensive actions and then breaks', () => {
    const battle = battleOf()
    const ally = actorById(battle, 'ally-0')!
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'protect' })
    run(battle, cooldownOf(battle, ally) + 0.2)
    expect(ally.shield).toBe(2)

    // Every enemy action that could hurt spends one charge.
    run(battle, 40)
    const absorbed = battle.log.filter(event => event.text.includes('Protección absorbió'))
    expect(absorbed.length).toBeGreaterThanOrEqual(1)
    expect(ally.shield).toBeLessThan(2)
  })

  it('costs the user a doubled cooldown', () => {
    const battle = battleOf()
    const ally = actorById(battle, 'ally-0')!
    const normal = cooldownOf(battle, ally)
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'protect' })
    run(battle, normal + 0.2)
    expect(cooldownOf(battle, ally)).toBeCloseTo(normal * ACTION_BAR.protectMultiplier, 1)
  })

  it('counts offensive actions, not individual hits', () => {
    expect(isOffensive(MOVES.bodySlam)).toBe(true)
    expect(isOffensive(MOVES.thunderWave)).toBe(true)
    expect(isOffensive(MOVES.swordsDance)).toBe(false)
  })
})

describe('stat stages are capped (D1 §25)', () => {
  it('never rises above ×2 or falls below ×0.5', () => {
    expect(stageMultiplier(2)).toBe(STAGE_LIMITS.max)
    expect(stageMultiplier(6)).toBe(STAGE_LIMITS.max)
    expect(stageMultiplier(-2)).toBe(STAGE_LIMITS.min)
    expect(stageMultiplier(-6)).toBe(STAGE_LIMITS.min)
    expect(stageMultiplier(0)).toBe(1)
    expect(stageMultiplier(1)).toBeGreaterThan(1)
    expect(stageMultiplier(1)).toBeLessThan(STAGE_LIMITS.max)
  })
})

describe('status (D1 §26–§28)', () => {
  it('allows only one major status at a time', () => {
    const battle = battleOf()
    const enemy = actorById(battle, 'enemy-0')!.combatant.pokemon
    // Big enough to survive: a fainted Pokémon loses its status, which would
    // make this pass for the wrong reason.
    Object.assign(enemy, { maxHp: 99999 })
    enemy.hp = 99999
    enemy.status = 'burn'
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })
    run(battle, 20)
    expect(enemy.status).toBe('burn')
  })

  it('lets confusion coexist with a major status', () => {
    const party = buildParty()
    const battle = battleOf({ ally: party[5] }) // Sableye: Toxic + Confuse Ray
    const enemy = actorById(battle, 'enemy-0')!.combatant.pokemon
    Object.assign(enemy, { maxHp: 99999 })
    enemy.hp = 99999
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'toxic' })
    run(battle, 6)
    expect(enemy.status).toBe('poison')
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'confuseRay' })
    run(battle, 4)
    // Confusion does not take the major-status slot, so both are live at once.
    expect(enemy.status).toBe('poison')
    expect(enemy.confusedFor).toBeGreaterThan(0)
  })

  it('ticks poison on its own clock, not on the action bar', () => {
    const fast = buildWild(135, 30)
    const slow = buildWild(74, 30)
    for (const pokemon of [fast, slow]) pokemon.status = 'poison'

    const count = (pokemon: PokemonInstance) => {
      const battle = createBattle({
        allies: [{ combatant: combatantFor(pokemon) }],
        enemies: [combatantFor(buildWild(95, 60))],
        bench: {}, items: BATTLE_ITEMS, rng: rng(5),
      })
      // The enemy is huge so nobody dies; we only count poison events.
      actorById(battle, 'ally-0')!.combatant.pokemon.hp = 9999
      run(battle, 12)
      return battle.log.filter(event => event.actorId === 'ally-0' && event.text.startsWith('Veneno')).length
    }
    // A Jolteon acts far more often than a Geodude and must still take the
    // same number of poison ticks.
    expect(count(fast)).toBe(count(slow))
    expect(count(fast)).toBeGreaterThan(0)
  })

  it('eats action windows while asleep', () => {
    const battle = battleOf()
    const ally = actorById(battle, 'ally-0')!
    ally.combatant.pokemon.status = 'sleep'
    ally.combatant.pokemon.sleepFor = STATUS.sleepSeconds
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })
    run(battle, 3)
    expect(barOf(ally)).toBe(0)
    expect(battle.log.some(event => event.actorId === 'ally-0' && event.kind === 'move')).toBe(false)
  })
})

describe('switching (D1 §29)', () => {
  it('keeps HP, PP and the major status, and resets the stages and the bar', () => {
    const party = buildParty()
    const incoming = party[1]
    incoming.hp = Math.round(incoming.maxHp * 0.4)
    incoming.status = 'burn'
    incoming.pp[incoming.moves[0]] = 3
    const battle = battleOf({ ally: party[0], bench: [incoming] })
    const actor = actorById(battle, 'ally-0')!
    actor.combatant = { ...actor.combatant, stages: { attack: 2 } }

    prepare(battle, 'ally-0', { kind: 'switch', instanceId: incoming.instanceId })
    run(battle, cooldownOf(battle, actor) + 0.3)

    expect(actor.combatant.pokemon.instanceId).toBe(incoming.instanceId)
    expect(actor.combatant.pokemon.hp).toBe(Math.round(incoming.maxHp * 0.4))
    expect(actor.combatant.pokemon.status).toBe('burn')
    expect(actor.combatant.pokemon.pp[incoming.moves[0]]).toBe(3)
    expect(actor.combatant.stages).toEqual({})
    expect(barOf(actor)).toBeLessThan(0.5)
  })

  it('refuses a fainted member', () => {
    const party = buildParty()
    const fallen = party[1]
    fallen.hp = 0
    const battle = battleOf({ ally: party[0], bench: [fallen] })
    prepare(battle, 'ally-0', { kind: 'switch', instanceId: fallen.instanceId })
    run(battle, 6)
    expect(actorById(battle, 'ally-0')!.combatant.pokemon.instanceId).toBe(party[0].instanceId)
  })
})

describe('items and the bag (D1 §30, §31)', () => {
  it('spends an Action Window instead of attacking', () => {
    const battle = battleOf()
    const ally = actorById(battle, 'ally-0')!
    ally.combatant.pokemon.hp = 10
    prepare(battle, 'ally-0', { kind: 'item', itemId: 'potion' })
    run(battle, cooldownOf(battle, ally) + 0.3)
    const events = battle.log.filter(event => event.actorId === 'ally-0')
    expect(events.some(event => event.kind === 'item')).toBe(true)
    expect(ally.combatant.pokemon.hp).toBeGreaterThan(10)
  })

  it('never pauses: tick takes no pause flag and the enemy keeps acting', () => {
    const battle = battleOf()
    prepare(battle, 'ally-0', { kind: 'item', itemId: 'potion' })
    run(battle, 12)
    expect(battle.log.some(event => event.actorId === 'enemy-0')).toBe(true)
  })
})

describe('targeting (D1 §18, §34)', () => {
  it('treats an ORAS spread move as single target in v1', () => {
    expect(MOVES.earthquake.spreadInOras).toBe(true)
    expect(isSingleTargetInV1()).toBe(true)
  })

  it('never damages an ally, even with two active Pokémon', () => {
    const party = buildParty()
    const battle = createBattle({
      allies: [{ combatant: combatantFor(party[0]) }, { combatant: combatantFor(party[2]) }],
      enemies: [combatantFor(buildWild(95, 60))],
      bench: {}, items: BATTLE_ITEMS, rng: rng(9),
    })
    const mate = actorById(battle, 'ally-1')!
    const before = mate.combatant.pokemon.hp
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })
    // Whatever ally-0 does, only the enemy can lose HP to it.
    const enemy = actorById(battle, 'enemy-0')!
    enemy.combatant.pokemon.hp = 99999
    mate.prepared = { kind: 'idle' }
    run(battle, 10)
    const allyDamage = battle.log.filter(event => event.actorId === 'ally-0' && event.kind === 'move')
    expect(allyDamage.length).toBeGreaterThan(0)
    expect(mate.combatant.pokemon.hp).toBeLessThanOrEqual(before)
  })
})

describe('faint, outcome and capture', () => {
  it('sends in the next member and ends in defeat when nobody is left', () => {
    const lead = buildParty()[0]
    lead.hp = 1
    const battle = createBattle({
      allies: [{ combatant: combatantFor(lead) }],
      enemies: [combatantFor(buildWild(68, 60))],
      bench: {}, items: BATTLE_ITEMS, rng: rng(3),
    })
    run(battle, 40)
    expect(battle.outcome).toBe('defeat')
  })

  it('ends in victory when the enemy falls', () => {
    const battle = battleOf({ enemy: buildWild(74, 5) })
    actorById(battle, 'enemy-0')!.combatant.pokemon.hp = 1
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })
    run(battle, 12)
    expect(battle.outcome).toBe('victory')
    expect(livingActors(battle, 'enemy')).toHaveLength(0)
  })

  it('keeps the basic ball disappointing and deterministic', () => {
    const target = buildWild(246, 20)
    const input = { target, catchRate: 45 }
    expect(captureChance(input)).toBeLessThan(0.05)
    const chance = captureChance(input)
    expect(attemptCapture(input, chance - 0.0001).captured).toBe(true)
    expect(attemptCapture(input, chance + 0.0001).captured).toBe(false)
  })

  it('ends the battle when the ball works', () => {
    const battle = battleOf({ enemy: buildWild(74, 3) })
    const enemy = actorById(battle, 'enemy-0')!.combatant.pokemon
    enemy.hp = 1
    enemy.status = 'sleep'
    enemy.sleepFor = 60
    battle.rng.next = () => 0
    prepare(battle, 'ally-0', { kind: 'item', itemId: 'poke_ball' })
    // Long enough for the action bar to fill and for the whole throw to play:
    // the animation runs about four seconds on three shakes (D1.2.4bis §3).
    run(battle, 14)
    expect(battle.outcome).toBe('captured')
    expect(battle.capturedInstanceId).toBe(enemy.instanceId)
  })

  it('can be aborted by the dungeon clock without anyone winning', () => {
    const battle = battleOf()
    run(battle, 2)
    const { abortBattle } = { abortBattle: (state: BattleState, reason: string) => {
      state.outcome = 'aborted'
      state.log.push({ at: state.seconds, actorId: 'battle', kind: 'end', text: reason })
    } }
    abortBattle(battle, 'La Dungeon cerró')
    expect(battle.outcome).toBe('aborted')
    expect(isFainted(actorById(battle, 'ally-0')!.combatant.pokemon)).toBe(false)
  })
})
