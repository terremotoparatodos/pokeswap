// D4 — the Alpha, co-op scaling, who gets loot, and what happens when the bag
// is full. Plus the reservation contract the server will have to honour.

import { describe, expect, it } from 'vitest'
import { BOSS_LOOT } from '../data/runFixtures'
import {
  activeAlliesFor, alphaCombatModifiers, alphaModifier, bossScaling, COOP,
  effectivePowerMultiple, phaseFor,
} from './alpha'
import { DUNGEON_TIERS } from './tiers'
import {
  availableEncounter, beginCombat, claim, isBusyForOthers, OccupancyRegistry,
  release, RESERVATION_SECONDS, resolveCombat,
} from './occupancy'
import { deliverRewards, participation, personalLoot, resolvePending, type ParticipationInput } from './rewards'

describe('alpha modifier', () => {
  it.each(DUNGEON_TIERS)('lands near four times the effective power on tier %s', tier => {
    const multiple = effectivePowerMultiple(alphaModifier(tier))
    expect(multiple).toBeGreaterThan(3.2)
    expect(multiple).toBeLessThan(5)
  })

  it('never reaches that number by multiplying everything, least of all Speed', () => {
    const alpha = alphaModifier('S')
    expect(alpha.speed).toBeLessThanOrEqual(1.1)
    expect(alpha.damageDealt).toBeLessThan(2)
    expect(alpha.defense).toBeLessThan(1.5)
    // The bulk is where the difficulty lives.
    expect(alpha.hp).toBeGreaterThan(alpha.damageDealt)
  })

  it('resists status so paralysing it is not an instant win', () => {
    expect(alphaModifier('B').statusResistance).toBeGreaterThan(0)
    expect(alphaModifier('B').statusResistance).toBeLessThan(1)
  })

  it('hits harder as it falls, in readable phases', () => {
    expect(phaseFor(1).index).toBe(1)
    expect(phaseFor(0.5).index).toBe(2)
    expect(phaseFor(0.2).index).toBe(3)
    expect(phaseFor(0.2).damageBonus).toBeGreaterThan(phaseFor(1).damageBonus)
  })
})

describe('co-op', () => {
  it('gives a solo player two active Pokémon and a group one each', () => {
    expect(activeAlliesFor(1)).toBe(2)
    expect(activeAlliesFor(2)).toBe(2)
    expect(activeAlliesFor(4)).toBe(4)
    expect(activeAlliesFor(9)).toBe(COOP.maxActiveAllies)
  })

  it('makes the boss tougher with more players without making it absurd', () => {
    const solo = bossScaling(1)
    const four = bossScaling(4)
    expect(solo.hp).toBe(1)
    expect(four.hp).toBeGreaterThan(solo.hp)
    // The failure mode to avoid: four players facing four times the damage.
    expect(four.damageDealt).toBeLessThan(1.5)
    expect(four.hp).toBeLessThan(4)
  })

  it('still rewards bringing friends: bulk per player goes down', () => {
    const perPlayer = (players: number) => bossScaling(players).hp / players
    expect(perPlayer(4)).toBeLessThan(perPlayer(1))
    expect(perPlayer(2)).toBeLessThan(perPlayer(1))
  })

  it('clamps the party size to the approved maximum', () => {
    expect(bossScaling(99).players).toBe(COOP.maxPlayers)
    expect(bossScaling(0).players).toBe(1)
  })

  it('hands the battle engine one coherent set of modifiers', () => {
    const solo = alphaCombatModifiers('B', 1, 1)
    const group = alphaCombatModifiers('B', 4, 0.2)
    expect(group.hpMultiplier).toBeGreaterThan(solo.hpMultiplier)
    expect(group.modifiers.damageDealt).toBeGreaterThan(solo.modifiers.damageDealt!)
    expect(solo.modifiers.damageTaken).toBeLessThan(1)
    expect(group.phase.index).toBe(3)
  })
})

describe('encounter occupancy', () => {
  it('grants the encounter to exactly one of two simultaneous claims', () => {
    const state = availableEncounter('wild-1')
    const first = claim(state, 'ana', 0)
    const second = claim(first.state, 'beto', 0)
    expect(first.granted).toBe(true)
    expect(second.granted).toBe(false)
    expect(second.reason).toBe('busy')
    expect(first.state.holder).toBe('ana')
  })

  it('shows the encounter as busy to everyone else', () => {
    const reserved = claim(availableEncounter('wild-1'), 'ana', 0).state
    expect(isBusyForOthers(reserved, 'beto', 0)).toBe(true)
    expect(isBusyForOthers(reserved, 'ana', 0)).toBe(false)
  })

  it('only lets the holder start the fight', () => {
    const reserved = claim(availableEncounter('wild-1'), 'ana', 0).state
    expect(beginCombat(reserved, 'beto', 1).granted).toBe(false)
    const started = beginCombat(reserved, 'ana', 1)
    expect(started.granted).toBe(true)
    expect(started.state.status).toBe('IN_COMBAT')
    expect(claim(started.state, 'beto', 1).reason).toBe('busy')
  })

  it('frees an abandoned reservation instead of locking it forever', () => {
    const reserved = claim(availableEncounter('wild-1'), 'ana', 0).state
    const late = claim(reserved, 'beto', RESERVATION_SECONDS + 1)
    expect(late.granted).toBe(true)
    expect(late.state.holder).toBe('beto')
  })

  it('returns it to the pool when the holder walks away', () => {
    const reserved = claim(availableEncounter('wild-1'), 'ana', 0).state
    const freed = release(reserved, 'ana')
    expect(freed.status).toBe('AVAILABLE')
    expect(claim(freed, 'beto', 1).granted).toBe(true)
  })

  it('is gone once it was defeated or captured', () => {
    const done = resolveCombat(availableEncounter('wild-1'), 'defeated')
    expect(claim(done, 'ana', 0).reason).toBe('gone')
    const caught = resolveCombat(availableEncounter('wild-2'), 'despawned')
    expect(claim(caught, 'ana', 0).reason).toBe('gone')
  })

  it('keeps several encounters independent in the registry', () => {
    const registry = new OccupancyRegistry()
    expect(registry.claim('a', 'ana', 0).granted).toBe(true)
    expect(registry.claim('b', 'beto', 0).granted).toBe(true)
    expect(registry.claim('a', 'beto', 0).granted).toBe(false)
  })
})

describe('boss rewards', () => {
  const players: ParticipationInput[] = [
    { playerId: 'ana', damage: 900, actions: 20, activeSeconds: 60, presentAtKill: true },
    { playerId: 'beto', damage: 60, actions: 8, activeSeconds: 55, presentAtKill: true },
    { playerId: 'caro', damage: 0, actions: 0, activeSeconds: 60, presentAtKill: true },
    { playerId: 'dani', damage: 500, actions: 12, activeSeconds: 40, presentAtKill: false },
  ]

  it('excludes the player who stood there doing nothing', () => {
    const result = participation(players)
    const by = (id: string) => result.find(entry => entry.playerId === id)!
    expect(by('ana').eligible).toBe(true)
    expect(by('beto').eligible).toBe(true)
    expect(by('caro').eligible).toBe(false)
    expect(by('caro').reason).toBe('inactive')
  })

  it('excludes someone who was not there at the kill', () => {
    expect(participation(players).find(entry => entry.playerId === 'dani')!.reason).toBe('absent')
  })

  it('gives every eligible player their own roll, with no competition', () => {
    const eligible = participation(players)
    const rewards = personalLoot(31, 'exp-9', eligible, BOSS_LOOT)
    expect(rewards.map(reward => reward.playerId)).toEqual(['ana', 'beto'])
    for (const reward of rewards) expect(reward.entry).not.toBeNull()
    // Same seed, same expedition, same result: a replay reproduces both rolls.
    expect(personalLoot(31, 'exp-9', eligible, BOSS_LOOT)).toEqual(rewards)
  })

  it('rolls differently for different players', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      playerId: `p${i}`, damage: 100, actions: 10, activeSeconds: 60, presentAtKill: true,
    }))
    const rewards = personalLoot(7, 'exp-1', participation(many), BOSS_LOOT)
    expect(new Set(rewards.map(reward => reward.entry?.itemId)).size).toBeGreaterThan(1)
  })

  it('escrows a reward that does not fit instead of destroying it', () => {
    const eligible = participation(players)
    const rewards = personalLoot(31, 'exp-9', eligible, BOSS_LOOT)
    const result = deliverRewards(rewards, { ana: 1, beto: 0 })
    expect(result.delivered.map(reward => reward.playerId)).toEqual(['ana'])
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0].playerId).toBe('beto')
    expect(result.pending[0].reason).toBe('inventory-full')
  })

  it('lets the player keep, make room, or give the reward up', () => {
    const rewards = personalLoot(31, 'exp-9', participation(players), BOSS_LOOT)
    const { pending } = deliverRewards(rewards, { ana: 0, beto: 0 })
    const id = pending[0].id

    // Keeping it leaves it safe in escrow.
    expect(resolvePending(pending, id, 'keep').pending).toHaveLength(pending.length)
    // Making room grants it and asks the UI what to drop.
    const freed = resolvePending(pending, id, 'discardOther')
    expect(freed.granted).not.toBeNull()
    expect(freed.needsDiscard).toBe(true)
    expect(freed.pending).toHaveLength(pending.length - 1)
    // Only an explicit choice throws it away.
    const dropped = resolvePending(pending, id, 'discardReward')
    expect(dropped.granted).toBeNull()
    expect(dropped.pending).toHaveLength(pending.length - 1)
  })
})
