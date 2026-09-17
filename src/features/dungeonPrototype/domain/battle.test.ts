// D2 — the Action Bar, the four moves, items under pressure, and no pause.

import { describe, expect, it } from 'vitest'
import { BATTLE_ITEMS, buildParty, buildWild, combatantFor } from '../data/runFixtures'
import { actorById, barOf, createBattle, livingActors, prepare, tick, type BattleState } from './battle'
import { attemptCapture, captureChance } from './capture'
import { ACTION_BAR, barSecondsFor, fillSeconds } from './damage'
import { MOVES, releaseThreshold } from './moves'
import { createRng } from './rng'
import { isFainted, type PokemonInstance } from './party'

const rng = (seed = 7) => createRng(seed)

function battleOf(options: { ally?: PokemonInstance; enemy?: PokemonInstance; bench?: PokemonInstance[] } = {}): BattleState {
  const party = buildParty()
  const ally = options.ally ?? party[0]
  const enemy = options.enemy ?? buildWild(74, 25)
  return createBattle({
    allies: [combatantFor(ally)],
    enemies: [combatantFor(enemy)],
    bench: options.bench ?? party.slice(1, 3),
    items: BATTLE_ITEMS,
    rng: rng(),
  })
}

/** Runs the clock in small steps, as a render loop would. */
const run = (battle: BattleState, seconds: number, step = 1 / 30): BattleState => {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) tick(battle, step)
  return battle
}

describe('speed and the action bar', () => {
  it('fills faster for a faster Pokémon, within its caps', () => {
    const slow = fillSeconds(15)
    const fast = fillSeconds(130)
    expect(slow).toBeGreaterThan(fast)
    expect(fast).toBeGreaterThanOrEqual(ACTION_BAR.minFillSeconds)
    expect(slow).toBeLessThanOrEqual(ACTION_BAR.maxFillSeconds)
    // The point of the caps: nobody acts three times per enemy action.
    expect(slow / fast).toBeLessThan(2.5)
  })

  it('clamps absurd speeds instead of letting the bar vanish', () => {
    expect(fillSeconds(100000)).toBe(ACTION_BAR.minFillSeconds)
    expect(fillSeconds(0)).toBeLessThanOrEqual(ACTION_BAR.maxFillSeconds)
  })

  it('halves effective speed under paralysis, so the status costs real time', () => {
    const battle = battleOf()
    const actor = actorById(battle, 'ally-0')!
    const healthy = barSecondsFor(actor.combatant)
    actor.combatant.pokemon.status = 'paralysis'
    expect(barSecondsFor(actor.combatant)).toBeGreaterThan(healthy)
  })

  it('advances the bar over time and empties it when the action fires', () => {
    const battle = battleOf()
    // Only a move this Pokémon actually knows can be prepared.
    expect(prepare(battle, 'ally-0', { kind: 'move', moveId: 'tackle' })).toBe(false)
    expect(prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })).toBe(true)
    const actor = actorById(battle, 'ally-0')!
    const seconds = barSecondsFor(actor.combatant)
    run(battle, seconds * 0.5)
    expect(barOf(actor)).toBeGreaterThan(0.3)
    expect(barOf(actor)).toBeLessThan(0.8)
    run(battle, seconds * 0.6)
    expect(battle.log.some(event => event.kind === 'move')).toBe(true)
  })

  it('releases a priority move before the bar is full', () => {
    expect(releaseThreshold(MOVES.quickAttack)).toBeLessThan(1)
    expect(releaseThreshold(MOVES.tackle)).toBe(1)
  })
})

describe('preparing an action', () => {
  it('lets the player change the prepared move while the bar fills', () => {
    const battle = battleOf()
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'tackle' })
    run(battle, 0.5)
    expect(prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })).toBe(true)
    const actor = actorById(battle, 'ally-0')!
    expect(actor.prepared).toEqual({ kind: 'move', moveId: 'bodySlam' })
    // Changing the choice does not reset the progress already made.
    expect(barOf(actor)).toBeGreaterThan(0)
  })

  it('executes whatever is prepared at the moment the bar completes', () => {
    const battle = battleOf()
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'tackle' })
    run(battle, 0.6)
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'swordsDance' })
    run(battle, 4)
    const used = battle.log.filter(event => event.actorId === 'ally-0' && event.kind === 'move')
    expect(used[0].text).toContain('Danza Espada')
  })

  it('refuses a move with no PP left', () => {
    const battle = battleOf()
    const pokemon = actorById(battle, 'ally-0')!.combatant.pokemon
    expect(prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })).toBe(true)
    pokemon.pp.bodySlam = 0
    expect(prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })).toBe(false)
  })

  it('spends PP when the move actually fires', () => {
    const battle = battleOf()
    const pokemon = actorById(battle, 'ally-0')!.combatant.pokemon
    const before = pokemon.pp.bodySlam
    prepare(battle, 'ally-0', { kind: 'move', moveId: 'bodySlam' })
    run(battle, 4)
    expect(pokemon.pp.bodySlam).toBe(before - 1)
  })
})

describe('items are not free', () => {
  it('spends an Action Window instead of attacking', () => {
    const battle = battleOf()
    const ally = actorById(battle, 'ally-0')!
    ally.combatant.pokemon.hp = 10
    prepare(battle, 'ally-0', { kind: 'item', itemId: 'potion' })
    run(battle, 4)
    const events = battle.log.filter(event => event.actorId === 'ally-0')
    expect(events.some(event => event.kind === 'item')).toBe(true)
    expect(events.some(event => event.kind === 'move')).toBe(false)
    expect(ally.combatant.pokemon.hp).toBeGreaterThan(10)
  })

  it('revives a fainted bench member instead of healing it', () => {
    const party = buildParty()
    const fallen = party[1]
    fallen.hp = 0
    const battle = battleOf({ ally: party[0], bench: [fallen] })
    prepare(battle, 'ally-0', { kind: 'item', itemId: 'revive', targetId: fallen.instanceId })
    run(battle, 4)
    expect(isFainted(fallen)).toBe(false)
  })

  it('never pauses: the enemy bar keeps filling while the bag is open', () => {
    const battle = battleOf()
    const enemy = actorById(battle, 'enemy-0')!
    // "Opening the bag" is UI state the engine cannot even hear about: the only
    // clock is `tick`, and it takes no pause flag.
    const before = barOf(enemy)
    run(battle, 1)
    expect(barOf(enemy) > before || battle.log.some(event => event.actorId === 'enemy-0')).toBe(true)
  })
})

describe('switching', () => {
  it('spends an Action Window and brings the chosen member in', () => {
    const party = buildParty()
    const incoming = party[1]
    const battle = battleOf({ ally: party[0], bench: [incoming] })
    prepare(battle, 'ally-0', { kind: 'switch', instanceId: incoming.instanceId })
    run(battle, 4)
    const actor = actorById(battle, 'ally-0')!
    expect(actor.combatant.pokemon.instanceId).toBe(incoming.instanceId)
    expect(battle.log.some(event => event.kind === 'switch')).toBe(true)
  })

  it('will not switch to a fainted member', () => {
    const party = buildParty()
    const fallen = party[1]
    fallen.hp = 0
    const battle = battleOf({ ally: party[0], bench: [fallen] })
    prepare(battle, 'ally-0', { kind: 'switch', instanceId: fallen.instanceId })
    run(battle, 4)
    expect(actorById(battle, 'ally-0')!.combatant.pokemon.instanceId).toBe(party[0].instanceId)
  })
})

describe('faint and outcome', () => {
  it('sends in the next member when the active one falls', () => {
    const party = buildParty()
    const battle = battleOf({ ally: party[0], bench: [party[1]] })
    actorById(battle, 'ally-0')!.combatant.pokemon.hp = 1
    actorById(battle, 'enemy-0')!.combatant.pokemon.hp = 99999
    run(battle, 12)
    expect(battle.log.some(event => event.kind === 'faint')).toBe(true)
  })

  it('ends in defeat when nobody is left', () => {
    const party = buildParty()
    const lead = party[0]
    lead.hp = 1
    const battle = createBattle({
      allies: [combatantFor(lead)],
      enemies: [combatantFor(buildWild(68, 60))],
      bench: [],
      items: BATTLE_ITEMS,
      rng: rng(3),
    })
    run(battle, 30)
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
})

describe('capture', () => {
  it('is deterministic for a given roll', () => {
    const target = buildWild(246, 20)
    const input = { target, catchRate: 45 }
    const chance = captureChance(input)
    expect(attemptCapture(input, chance - 0.0001).captured).toBe(true)
    expect(attemptCapture(input, chance + 0.0001).captured).toBe(false)
  })

  it('is very unlikely with a basic ball at full health', () => {
    const target = buildWild(246, 20)
    expect(captureChance({ target, catchRate: 45 })).toBeLessThan(0.05)
  })

  it('improves as the target weakens and takes a status', () => {
    const healthy = buildWild(246, 20)
    const weak = buildWild(246, 20)
    weak.hp = Math.max(1, Math.round(weak.maxHp * 0.05))
    weak.status = 'sleep'
    expect(captureChance({ target: weak, catchRate: 45 }))
      .toBeGreaterThan(captureChance({ target: healthy, catchRate: 45 }) * 3)
  })

  it('cannot be thrown at a fainted Pokémon', () => {
    const target = buildWild(246, 20)
    target.hp = 0
    expect(captureChance({ target, catchRate: 45 })).toBe(0)
  })

  it('ends the battle when the ball works', () => {
    const battle = battleOf({ enemy: buildWild(74, 3) })
    const enemy = actorById(battle, 'enemy-0')!.combatant.pokemon
    enemy.hp = 1
    enemy.status = 'sleep'
    enemy.sleepFor = 60
    // Force the throw to succeed by removing the doubt from the stream.
    battle.rng.next = () => 0
    prepare(battle, 'ally-0', { kind: 'item', itemId: 'poke_ball' })
    run(battle, 6)
    expect(battle.outcome).toBe('captured')
    expect(battle.capturedInstanceId).toBe(enemy.instanceId)
  })
})
