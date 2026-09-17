// D1.1 — the flows the Field Lab drives: interacting with a Pokémon starts a
// fight, winning clears it and can drop the key, the door opens, a floor change
// keeps the wear, a capture becomes expedition loot, and retreat, wipe and the
// boss transition all end up where they should.

import { describe, expect, it } from 'vitest'
import { BATTLE_ITEMS, buildParty, buildWild, combatantFor, STARTING_INVENTORY } from '../data/runFixtures'
import { definitionById, poolOf } from '../data/dungeonCatalog'
import { createBattle, tick } from './battle'
import { createSpawn } from './dungeonSpawn'
import { isWalkable, samePoint } from './floorTiles'
import { damage, isFainted } from './party'
import {
  advanceClock, atStairs, descend, endRun, engage, enterAntechamber, move, openChest,
  reachable, settleCombat, startBoss, startPlay, type PlaySession,
} from './playSession'

const definition = definitionById('ignea')!

function run(seed = 4242): PlaySession {
  const now = 1_000_000
  return startPlay({
    definition,
    spawn: createSpawn({
      spawnId: 's', definition, position: { tx: 0, ty: 0, areaId: 'pradera' }, now, minutes: 180, seed,
    }),
    party: buildParty(),
    inventory: STARTING_INVENTORY,
    pool: poolOf(definition),
    now,
    expeditionSeed: seed,
  })
}

const deps = {
  makeWild: (speciesId: number, level: number) => buildWild(speciesId, level),
  makeCombatant: (pokemon: ReturnType<typeof buildWild>) => combatantFor(pokemon),
  battleItems: BATTLE_ITEMS,
}

/** Walks the player next to an entity by teleporting to a neighbouring tile. */
function standBeside(session: PlaySession, entityId: string): void {
  const entity = session.entities.find(candidate => candidate.id === entityId)!
  const spots = [
    { x: entity.at.x - 1, y: entity.at.y }, { x: entity.at.x + 1, y: entity.at.y },
    { x: entity.at.x, y: entity.at.y - 1 }, { x: entity.at.x, y: entity.at.y + 1 },
  ]
  session.player = spots.find(spot => isWalkable(session.tiles, spot.x, spot.y)) ?? entity.at
}

const firstEncounter = (session: PlaySession) =>
  session.entities.find(entity => entity.kind === 'encounter' && !entity.taken)!

describe('walking the floor', () => {
  it('starts on a walkable tile and refuses to walk into rock', () => {
    const session = run()
    expect(isWalkable(session.tiles, session.player.x, session.player.y)).toBe(true)
    const before = { ...session.player }
    for (let i = 0; i < 40; i++) move(session, 1, 0)
    expect(isWalkable(session.tiles, session.player.x, session.player.y)).toBe(true)
    expect(session.player).not.toEqual(before)
  })

  it('never walks onto a Pokémon, and a Pokémon never starts the fight', () => {
    const session = run()
    const entity = firstEncounter(session)
    session.player = { x: entity.at.x - 1, y: entity.at.y }
    expect(move(session, 1, 0)).toBe(false)
    expect(samePoint(session.player, entity.at)).toBe(false)
    // Standing next to it for a while still does nothing: no aggro.
    advanceClock(session, 30_000)
    expect(session.phase).toBe('exploring')
    expect(session.battle).toBeNull()
  })

  it('offers what is within reach, and only that', () => {
    const session = run()
    const entity = firstEncounter(session)
    standBeside(session, entity.id)
    expect(reachable(session).map(item => item.id)).toContain(entity.id)
    session.player = session.tiles.entrance
    expect(reachable(session).some(item => item.id === entity.id)).toBe(false)
  })
})

describe('interact → battle → reward', () => {
  it('starts the fight only when the player asks, and from an adjacent tile', () => {
    const session = run()
    const entity = firstEncounter(session)
    session.player = session.tiles.entrance
    expect(engage(session, entity.id, deps)).toBe(false)
    standBeside(session, entity.id)
    expect(engage(session, entity.id, deps)).toBe(true)
    expect(session.phase).toBe('combat')
    expect(session.battle).not.toBeNull()
    expect(session.battle!.actors.filter(actor => actor.side === 'enemy')).toHaveLength(1)
  })

  it('clears the Pokémon from the floor after a win and can drop the key', () => {
    const session = run()
    const entity = firstEncounter(session)
    standBeside(session, entity.id)
    engage(session, entity.id, deps)
    // End it the way the engine would.
    session.battle!.actors.filter(actor => actor.side === 'enemy')
      .forEach(actor => damage(actor.combatant.pokemon, 99999))
    tick(session.battle!, 1 / 30)
    expect(session.battle!.outcome).toBe('victory')

    settleCombat(session, () => [{ itemId: 'cave_shard', quantity: 2 }])
    expect(session.phase).toBe('exploring')
    expect(session.entities.find(item => item.id === entity.id)!.taken).toBe(true)
    expect(session.expedition.expeditionLoot.cave_shard).toBe(2)
  })

  it('turns a capture into expedition loot instead of property', () => {
    const session = run()
    const entity = firstEncounter(session)
    standBeside(session, entity.id)
    engage(session, entity.id, deps)
    session.battle!.outcome = 'captured'
    session.battle!.capturedInstanceId = 'caught-1'
    settleCombat(session, () => [])
    expect(session.expedition.expeditionCaptures).toHaveLength(1)
    expect(session.expedition.expeditionCaptures[0].floor).toBe(1)
    // Losing the run loses the capture.
    const result = endRun(session, 'wipe')
    expect(result.lostCaptures).toHaveLength(1)
    expect(result.extractedCaptures).toHaveLength(0)
  })

  it('opens a chest from an adjacent tile and adds the loot', () => {
    const session = run()
    const chest = session.entities.find(entity => entity.kind === 'chest')
    if (!chest) return
    session.player = session.tiles.entrance
    expect(openChest(session, chest.id, () => [{ itemId: 'iron_chunk', quantity: 1 }])).toBe(false)
    standBeside(session, chest.id)
    expect(openChest(session, chest.id, () => [{ itemId: 'iron_chunk', quantity: 1 }])).toBe(true)
    expect(session.expedition.expeditionLoot.iron_chunk).toBe(1)
  })
})

describe('the door and the next floor', () => {
  it('stays locked until the key drops, and the stairs are where the player must stand', () => {
    const session = run()
    expect(session.expedition.key.hasKey).toBe(false)
    session.player = { ...session.tiles.entrance }
    expect(atStairs(session)).toBe(false)
    expect(descend(session)).toBe(false)

    session.player = session.tiles.exit
    expect(atStairs(session)).toBe(true)
    expect(descend(session)).toBe(false) // still no key
    session.expedition = { ...session.expedition, key: { hasKey: true, defeatsWithoutKey: 0 } }
    expect(descend(session)).toBe(true)
    expect(session.expedition.floor).toBe(2)
    expect(session.expedition.key.hasKey).toBe(false)
  })

  it('builds a fresh floor and keeps the wear across it', () => {
    const session = run()
    const lead = session.expedition.party[0]
    damage(lead, 40)
    lead.pp[lead.moves[0]] = 3
    const hp = lead.hp
    const before = session.tiles

    session.player = session.tiles.exit
    session.expedition = { ...session.expedition, key: { hasKey: true, defeatsWithoutKey: 0 } }
    descend(session)

    expect(session.tiles).not.toBe(before)
    expect(isWalkable(session.tiles, session.player.x, session.player.y)).toBe(true)
    expect(session.entities.length).toBeGreaterThan(0)
    expect(session.expedition.party[0].hp).toBe(hp)
    expect(session.expedition.party[0].pp[lead.moves[0]]).toBe(3)
  })
})

describe('the Alpha', () => {
  const atLastFloor = (): PlaySession => {
    const session = run()
    while (session.expedition.floor < session.expedition.floors) {
      session.expedition = { ...session.expedition, key: { hasKey: true, defeatsWithoutKey: 0 } }
      session.player = session.tiles.exit
      if (!descend(session)) break
    }
    session.player = session.tiles.exit
    return session
  }

  it('is reached through the antechamber, which heals nothing', () => {
    const session = atLastFloor()
    expect(session.expedition.floor).toBe(session.expedition.floors)
    const hurt = session.expedition.party[0]
    damage(hurt, 30)
    const hp = hurt.hp

    expect(enterAntechamber(session)).toBe(true)
    expect(session.phase).toBe('antechamber')
    expect(session.expedition.party[0].hp).toBe(hp)
  })

  it('starts with two active Pokémon when playing solo, and brings Boss Skills', () => {
    const session = atLastFloor()
    enterAntechamber(session)
    expect(startBoss(session, { ...deps, players: 1 })).toBe(true)
    expect(session.phase).toBe('boss')
    expect(session.battle!.actors.filter(actor => actor.side === 'ally')).toHaveLength(2)
    expect(session.bossKit.length).toBeGreaterThan(0)
    expect(session.boss).not.toBeNull()
  })

  it('gives each player one active Pokémon in a group', () => {
    const session = atLastFloor()
    enterAntechamber(session)
    startBoss(session, { ...deps, players: 3 })
    expect(session.battle!.actors.filter(actor => actor.side === 'ally')).toHaveLength(1)
  })
})

describe('ending the run', () => {
  it('retreats with the loot and resets to floor 1', () => {
    const session = run()
    session.expedition = { ...session.expedition, expeditionLoot: { iron_chunk: 3 } }
    const result = endRun(session, 'retreat')
    expect(result.outcome).toBe('EXTRACTED')
    expect(result.extractedLoot).toEqual({ iron_chunk: 3 })
    expect(result.nextEntryFloor).toBe(1)
    expect(session.phase).toBe('ended')
  })

  it('wipes to the Pokémon Center and loses what was inside', () => {
    const session = run()
    session.expedition = { ...session.expedition, expeditionLoot: { alpha_core: 1 } }
    const result = endRun(session, 'wipe')
    expect(result.outcome).toBe('RETURN_TO_NEAREST_POKEMON_CENTER')
    expect(result.lostLoot).toEqual({ alpha_core: 1 })
    expect(session.expedition.carriedInventory).toEqual(STARTING_INVENTORY)
  })

  it('auto-extracts when the dungeon clock runs out, without calling it a wipe', () => {
    const session = run()
    session.expedition = { ...session.expedition, expeditionLoot: { cave_shard: 4 } }
    advanceClock(session, 181 * 60_000)
    expect(session.phase).toBe('ended')
    expect(session.expedition.status).toBe('retreated')
    expect(session.result?.outcome).toBe('EXTRACTED')
    expect(session.result?.extractedLoot).toEqual({ cave_shard: 4 })
  })

  it('wipes on its own when the last Pokémon falls in combat', () => {
    const session = run()
    const entity = firstEncounter(session)
    standBeside(session, entity.id)
    engage(session, entity.id, deps)
    for (const member of session.expedition.party) damage(member, 99999)
    session.battle = createBattle({
      allies: [], enemies: [combatantFor(buildWild(74, 20))], bench: {}, items: BATTLE_ITEMS,
      rng: { next: () => 0.5, int: () => 0, chance: () => false, pick: () => undefined, shuffle: items => [...items] },
    })
    session.battle.outcome = 'defeat'
    settleCombat(session, () => [])
    expect(session.expedition.party.every(isFainted)).toBe(true)
    expect(session.phase).toBe('ended')
    expect(session.result?.outcome).toBe('RETURN_TO_NEAREST_POKEMON_CENTER')
  })
})
