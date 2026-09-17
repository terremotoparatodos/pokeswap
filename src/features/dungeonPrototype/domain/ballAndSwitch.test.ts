// D1.2.3 §3, §5 — the two fixes that touch the rules.
//
// The throw is its own moment: the fight is held while the ball flies and
// wobbles, and only then does it click or break open. And a switch brings the
// newcomer's own species with it, so it stops fighting with the stats, types
// and catch rate of the Pokémon that left.

import { describe, expect, it } from 'vitest'
import { ballDuration, BALL_TIMING, createBattle, flee, tick, type BattleState } from './battle'
import { BATTLE_ITEMS, buildParty, buildWild, combatantFor } from '../data/runFixtures'
import { damage } from './party'
import type { Rng } from './rng'

const alwaysRng = (value: number): Rng => ({
  next: () => value,
  int: (min: number) => min,
  chance: () => value < 0.5,
  pick: items => items[0],
  shuffle: items => [...items],
})

const BALLS = BATTLE_ITEMS

function fight(roll: number, foeHp = 1): BattleState {
  const party = buildParty()
  const wild = buildWild(74, 12)
  damage(wild, wild.maxHp - foeHp)
  return createBattle({
    allies: [{ combatant: combatantFor(party[0]) }],
    enemies: [combatantFor(wild)],
    bench: { p1: party.slice(1) },
    items: BALLS,
    rng: alwaysRng(roll),
    speciesFor: pokemon => combatantFor(pokemon).species,
  })
}

const throwBall = (battle: BattleState): void => {
  const ally = battle.actors.find(actor => actor.side === 'ally')!
  ally.prepared = { kind: 'item', itemId: 'poke_ball' }
  ally.bar = 1
  tick(battle, 1 / 60)
}

describe('the throw holds the fight (§5)', () => {
  it('starts a flight instead of deciding on the spot', () => {
    const battle = fight(0)
    throwBall(battle)
    expect(battle.throw).not.toBeNull()
    expect(battle.outcome).toBe('ongoing')
    expect(battle.throw!.remaining).toBeCloseTo(ballDuration(battle.throw!.shakes), 5)
  })

  it('freezes every clock while the ball is in the air', () => {
    const battle = fight(0)
    throwBall(battle)
    const seconds = battle.seconds
    const bars = battle.actors.map(actor => actor.bar)

    for (let i = 0; i < 10; i++) tick(battle, 1 / 60)
    expect(battle.seconds).toBe(seconds)
    expect(battle.actors.map(actor => actor.bar)).toEqual(bars)
    expect(battle.throw).not.toBeNull()
  })

  it('shakes, then catches, and the fight ends there', () => {
    const battle = fight(0) // a roll of 0 always catches
    throwBall(battle)
    expect(battle.throw!.shakes).toBe(3)

    let elapsed = 0
    while (battle.throw && elapsed < 10) {
      tick(battle, 1 / 30)
      elapsed += 1 / 30
    }
    expect(battle.outcome).toBe('captured')
    expect(battle.capturedInstanceId).not.toBeNull()
    expect(elapsed).toBeGreaterThanOrEqual(BALL_TIMING.flight)
  })

  it('breaks open on a miss and the fight carries on from where it froze', () => {
    const battle = fight(0.999, 999) // a full-health foe on a bad roll
    throwBall(battle)
    const bars = battle.actors.map(actor => actor.bar)

    for (let i = 0; i < 400 && battle.throw; i++) tick(battle, 1 / 60)
    expect(battle.outcome).toBe('ongoing')
    expect(battle.throw).toBeNull()
    // Nothing moved during the throw: the bars resume from the same place.
    expect(battle.actors.map(actor => actor.bar)).toEqual(bars)

    tick(battle, 0.5)
    expect(battle.seconds).toBeGreaterThan(0)
  })

  it('refuses a second ball while one is already in the air', () => {
    const battle = fight(0.999, 999)
    throwBall(battle)
    const first = battle.throw
    throwBall(battle)
    expect(battle.throw).toBe(first)
  })
})

describe('a switch brings its own species (§3)', () => {
  it('replaces the species, not only the Pokémon', () => {
    const battle = fight(0.5, 999)
    const ally = battle.actors.find(actor => actor.side === 'ally')!
    const before = ally.combatant.species
    const incoming = battle.bench.p1[0]

    ally.prepared = { kind: 'switch', instanceId: incoming.instanceId }
    ally.bar = 1
    tick(battle, 1 / 60)

    expect(ally.combatant.pokemon.instanceId).toBe(incoming.instanceId)
    expect(ally.combatant.species.speciesId).toBe(incoming.speciesId)
    expect(ally.combatant.species).not.toBe(before)
  })

  it('keeps the outgoing species when nobody said how to look one up', () => {
    const party = buildParty()
    const battle = createBattle({
      allies: [{ combatant: combatantFor(party[0]) }],
      enemies: [combatantFor(buildWild(74, 12))],
      bench: { p1: party.slice(1) },
      items: BALLS,
      rng: alwaysRng(0.5),
    })
    const ally = battle.actors.find(actor => actor.side === 'ally')!
    const before = ally.combatant.species
    ally.prepared = { kind: 'switch', instanceId: battle.bench.p1[0].instanceId }
    ally.bar = 1
    tick(battle, 1 / 60)
    expect(ally.combatant.species).toBe(before)
  })
})

describe('nobody stands there doing nothing (D1.2.4 §5)', () => {
  it('falls back on Combate when every move is out of PP, and it hurts', () => {
    const battle = fight(0.5, 999)
    const ally = battle.actors.find(actor => actor.side === 'ally')!
    const pokemon = ally.combatant.pokemon
    for (const moveId of pokemon.moves) pokemon.pp[moveId] = 0
    const before = pokemon.hp

    ally.bar = 1
    tick(battle, 1 / 60)

    expect(battle.log.some(event => event.text.startsWith('Combate:'))).toBe(true)
    // A quarter of its maximum, and it still hit the other side.
    expect(before - pokemon.hp).toBeGreaterThanOrEqual(Math.round(pokemon.maxHp * 0.25))
    expect(battle.log.some(event => event.text.includes('de daño'))).toBe(true)
  })

  it('never leaves a switch prepared, so the newcomer attacks', () => {
    const battle = fight(0.5, 999)
    const ally = battle.actors.find(actor => actor.side === 'ally')!
    ally.prepared = { kind: 'switch', instanceId: battle.bench.p1[0].instanceId }
    ally.bar = 1
    tick(battle, 1 / 60)
    expect(ally.prepared.kind).toBe('idle')

    // The very next window is an attack, not another switch.
    ally.bar = 1
    tick(battle, 1 / 60)
    const lines = battle.log.filter(event => event.actorId === ally.id)
    expect(lines.some(event => event.kind === 'move')).toBe(true)
    expect(lines.filter(event => event.kind === 'switch')).toHaveLength(1)
  })

  it('lets the player run from a fight without ending the run', () => {
    const battle = fight(0.5, 999)
    expect(flee(battle)).toBe(true)
    expect(battle.outcome).toBe('aborted')
    expect(flee(battle)).toBe(false)
  })
})
