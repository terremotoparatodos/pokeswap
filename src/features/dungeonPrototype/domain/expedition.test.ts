// D3 — what you keep, what you lose, and what the dungeon wears down.

import { describe, expect, it } from 'vitest'
import { buildParty, STARTING_INVENTORY } from '../data/runFixtures'
import {
  addExpeditionCapture, addExpeditionLoot, advanceFloor, consumeItem, grantKey, itemCount,
  retreat, shouldWipe, startExpedition, wipe, type ExpeditionState,
} from './expedition'
import { rollFloorKey, emptyKeyState } from './floorKey'
import { damage, isWiped, spendPp } from './party'

const start = (): ExpeditionState => startExpedition({
  expeditionId: 'exp-1',
  seed: 4242,
  floors: 6,
  party: buildParty(),
  carriedInventory: STARTING_INVENTORY,
})

const withKey = (state: ExpeditionState): ExpeditionState =>
  grantKey(state, rollFloorKey(emptyKeyState(), 0).state)

describe('expedition loot', () => {
  it('keeps what was found separate from what was carried in', () => {
    const state = addExpeditionLoot(start(), [{ itemId: 'iron_chunk', quantity: 2 }])
    expect(state.expeditionLoot).toEqual({ iron_chunk: 2 })
    expect(state.carriedInventory.potion).toBe(STARTING_INVENTORY.potion)
    expect(state.carriedInventory.iron_chunk).toBeUndefined()
  })

  it('hands the loot over when the player walks out', () => {
    const state = addExpeditionLoot(start(), [{ itemId: 'iron_chunk', quantity: 2 }])
    const result = retreat(state)
    expect(result.outcome).toBe('EXTRACTED')
    expect(result.extractedLoot).toEqual({ iron_chunk: 2 })
    expect(result.state.carriedInventory.iron_chunk).toBe(2)
    expect(result.state.expeditionLoot).toEqual({})
    expect(result.nextEntryFloor).toBe(1)
  })

  it('loses every bit of it on a wipe, and nothing that was carried in', () => {
    const state = addExpeditionLoot(start(), [{ itemId: 'alpha_core', quantity: 1 }])
    const result = wipe(state)
    expect(result.outcome).toBe('RETURN_TO_NEAREST_POKEMON_CENTER')
    expect(result.lostLoot).toEqual({ alpha_core: 1 })
    expect(result.state.expeditionLoot).toEqual({})
    expect(result.state.carriedInventory).toEqual(STARTING_INVENTORY)
  })

  it('leaves spent consumables spent after a wipe', () => {
    let state = start()
    state = consumeItem(state, 'potion').state
    state = consumeItem(state, 'potion').state
    expect(state.carriedInventory.potion).toBe(STARTING_INVENTORY.potion - 2)
    const result = wipe(state)
    expect(result.state.carriedInventory.potion).toBe(STARTING_INVENTORY.potion - 2)
    expect(result.state.spentConsumables).toEqual({ potion: 2 })
  })

  it('spends a consumable found inside once the carried ones run out', () => {
    let state = addExpeditionLoot(start(), [{ itemId: 'potion', quantity: 1 }])
    expect(itemCount(state, 'potion')).toBe(STARTING_INVENTORY.potion + 1)
    for (let i = 0; i < STARTING_INVENTORY.potion; i++) state = consumeItem(state, 'potion').state
    expect(state.carriedInventory.potion).toBeUndefined()
    const spent = consumeItem(state, 'potion')
    expect(spent.used).toBe(true)
    expect(spent.state.expeditionLoot.potion).toBeUndefined()
    expect(consumeItem(spent.state, 'potion').used).toBe(false)
  })
})

describe('captures made inside', () => {
  const larvitar = { instanceId: 'larvitar-18', speciesId: 246, level: 24, floor: 18 }

  it('are expedition loot, not property, until the player extracts', () => {
    const state = addExpeditionCapture(start(), larvitar)
    expect(state.expeditionCaptures).toHaveLength(1)
    expect(retreat(state).extractedCaptures).toEqual([larvitar])
  })

  it('are lost with everything else on a wipe', () => {
    const result = wipe(addExpeditionCapture(start(), larvitar))
    expect(result.lostCaptures).toEqual([larvitar])
    expect(result.extractedCaptures).toEqual([])
    expect(result.state.expeditionCaptures).toEqual([])
  })
})

describe('floor keys', () => {
  it('opens exactly one floor and is spent doing it', () => {
    const state = withKey(start())
    const result = advanceFloor(state)
    expect(result.advanced).toBe(true)
    expect(result.state.floor).toBe(2)
    expect(result.state.key.hasKey).toBe(false)
    expect(advanceFloor(result.state).reason).toBe('no-key')
  })

  it('never leaves the dungeon: not on retreat', () => {
    expect(retreat(withKey(start())).state.key.hasKey).toBe(false)
  })

  it('never leaves the dungeon: not on a wipe', () => {
    expect(wipe(withKey(start())).state.key.hasKey).toBe(false)
  })

  it('refuses to advance past the last floor', () => {
    const deep = { ...withKey(start()), floor: 6 }
    expect(advanceFloor(deep).reason).toBe('last-floor')
  })
})

describe('wear between floors', () => {
  it('carries HP and PP across the locked door, with no free healing', () => {
    let state = withKey(start())
    const lead = state.party[0]
    damage(lead, 30)
    spendPp(lead, lead.moves[0])
    const hpBefore = lead.hp
    const ppBefore = lead.pp[lead.moves[0]]

    state = advanceFloor(state).state
    expect(state.floor).toBe(2)
    expect(state.party[0].hp).toBe(hpBefore)
    expect(state.party[0].hp).toBeLessThan(state.party[0].maxHp)
    expect(state.party[0].pp[lead.moves[0]]).toBe(ppBefore)
  })

  it('works on its own copy, so restarting a run does not reuse a hurt party', () => {
    const fixture = buildParty()
    const state = startExpedition({
      expeditionId: 'exp-2', seed: 1, floors: 5, party: fixture, carriedInventory: {},
    })
    damage(state.party[0], 999)
    expect(fixture[0].hp).toBe(fixture[0].maxHp)
  })

  it('declares a wipe only when every member is down', () => {
    const state = start()
    for (const member of state.party.slice(0, -1)) damage(member, 9999)
    expect(shouldWipe(state)).toBe(false)
    damage(state.party[state.party.length - 1], 9999)
    expect(isWiped(state.party)).toBe(true)
    expect(shouldWipe(state)).toBe(true)
  })

  it('stops accepting loot once the expedition is over', () => {
    const ended = wipe(start()).state
    expect(addExpeditionLoot(ended, [{ itemId: 'iron_chunk', quantity: 1 }].map(s => s)).expeditionLoot).toEqual({})
    expect(consumeItem(ended, 'potion').used).toBe(false)
  })
})
