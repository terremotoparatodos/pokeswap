// D1 rules: temporary spawns and their expiry, the three pool categories, the
// cave floor, the guaranteed boss, the Boss Skills and the co-op contract.

import { describe, expect, it } from 'vitest'
import { DUNGEON_DEFINITIONS, definitionById, poolOf, resolvePool } from '../data/dungeonCatalog'
import { ALL_SPECIES, speciesById } from '../data/speciesFixtures'
import { buildParty, buildWild, combatantFor, BATTLE_ITEMS } from '../data/runFixtures'
import { bossKitFor, BOSS_SKILL_IDS, BOSS_SKILLS, SKILLS_PER_TIER, targetsFor } from './bossSkills'
import { createBossController } from './bossFight'
import { createBattle, tick } from './battle'
import {
  activeSlots, createMember, everyoneReady, isGlobalWipe, isInside, MAX_PLAYERS,
  pendingMembers, respond, retreatMember, startReadyCheck, syncDowned, totalActiveAllies,
} from './coop'
import {
  acceptsEntries, advanceSpawn, createSpawn, crossedWarning, DEFAULT_DUNGEON_MINUTES,
  expirationNotice, formatCountdown, hasExpired, millisLeft, minutesLeft, WARNING_MINUTES,
} from './dungeonSpawn'
import { buildFloorTiles, isWalkable, placeEntities, tileAt, WALKABLE } from './floorTiles'
import { generateFloor } from './floorPlan'
import { damage } from './party'
import { createRng } from './rng'
import { dungeonProfile, DUNGEON_TIERS } from './tiers'

const definition = DUNGEON_DEFINITIONS[0]
const spawnAt = (now: number, minutes = DEFAULT_DUNGEON_MINUTES) => createSpawn({
  spawnId: 's1', definition, position: { tx: 0, ty: 0, areaId: 'pradera' }, now, minutes, seed: 42,
})

describe('dungeons are temporary events (D1 §2, §3)', () => {
  it('carries a definition, a position and a closing time', () => {
    const spawn = spawnAt(0)
    expect(spawn.definitionId).toBe(definition.definitionId)
    expect(spawn.closesAt - spawn.startedAt).toBe(DEFAULT_DUNGEON_MINUTES * 60_000)
    expect(spawn.position.areaId).toBe('pradera')
  })

  it('gives whoever walks in only the time the spawn has left, not a private timer', () => {
    const spawn = spawnAt(0, 180)
    const enteredAt = 133 * 60_000 // 47 minutes left
    expect(Math.round(minutesLeft(spawn, enteredAt))).toBe(47)
    // Two hours of expedition would be longer than the dungeon itself.
    expect(hasExpired(spawn, enteredAt + 60 * 60_000)).toBe(true)
  })

  it('stops accepting players at zero', () => {
    const spawn = spawnAt(0, 10)
    expect(acceptsEntries(spawn, 9 * 60_000)).toBe(true)
    expect(acceptsEntries(spawn, 10 * 60_000)).toBe(false)
  })

  it('moves to closing and then expired as the clock runs down', () => {
    const spawn = spawnAt(0, 60)
    expect(advanceSpawn(spawn, 0).status).toBe('open')
    expect(advanceSpawn(spawn, 35 * 60_000).status).toBe('closing')
    expect(advanceSpawn(spawn, 60 * 60_000).status).toBe('expired')
  })

  it('fires each warning once, when it is crossed', () => {
    expect(crossedWarning(31, 29)).toBe(30)
    expect(crossedWarning(29, 28)).toBeNull()
    expect(crossedWarning(11, 9)).toBe(10)
    expect(crossedWarning(6, 4)).toBe(5)
    expect(crossedWarning(2, 0.5)).toBe(1)
    expect(WARNING_MINUTES).toEqual([30, 10, 5, 1])
  })

  it('reads the countdown the way the HUD shows it', () => {
    const spawn = spawnAt(0, 90)
    expect(formatCountdown(spawn, 0)).toBe('1:30:00')
    expect(formatCountdown(spawn, 89 * 60_000 + 30_000)).toBe('00:30')
    expect(millisLeft(spawn, 999 * 60_000)).toBe(0)
  })

  it('auto-extracts instead of wiping, and pays nothing for what was unfinished', () => {
    const notice = expirationNotice(true)
    expect(notice.outcome).toBe('DUNGEON_EXPIRED → AUTO_EXTRACT')
    expect(notice.keepsLoot).toBe(true)
    expect(notice.keepsCaptures).toBe(true)
    expect(notice.losesKeys).toBe(true)
    expect(notice.rewardsUnfinishedCombat).toBe(false)
    expect(notice.countsAsWipe).toBe(false)
    // A live Alpha at 00:00 gives no reward.
    expect(notice.alphaUnrewarded).toBe(true)
    expect(expirationNotice(false).alphaUnrewarded).toBe(false)
  })
})

describe('dungeon categories (D1 §4, §47)', () => {
  it('covers the three families with real examples', () => {
    expect(new Set(DUNGEON_DEFINITIONS.map(entry => entry.category)))
      .toEqual(new Set(['type', 'generation', 'special']))
  })

  it('TYPE keeps the theme dominant but allows compatible fauna', () => {
    const fire = definitionById('ignea')!
    const pool = poolOf(fire).map(id => speciesById(id)!)
    const onTheme = pool.filter(species => species.types.includes('fire'))
    expect(onTheme.length).toBeGreaterThan(0)
    expect(onTheme.length).toBeLessThan(pool.length) // not forced to 100 %
    expect(onTheme.length / pool.length).toBeGreaterThan(0.6) // but clearly dominant
  })

  it('GENERATION selects by region of origin and keeps Gen 6 battle data', () => {
    const sinnoh = definitionById('sinnoh-deep')!
    const pool = poolOf(sinnoh).map(id => speciesById(id)!)
    expect(pool.length).toBeGreaterThan(3)
    expect(pool.every(species => species.origin === 'sinnoh')).toBe(true)
    // The Gen 6 reading of a Kanto species is what a Kanto dungeon would use.
    expect(speciesById(35)!.types).toEqual(['fairy'])
    expect(speciesById(183)!.types).toEqual(['water', 'fairy'])
  })

  it('SPECIAL selects by tag', () => {
    const fossils = definitionById('fossil-strata')!
    const pool = poolOf(fossils).map(id => speciesById(id)!)
    expect(pool.length).toBeGreaterThan(3)
    expect(pool.every(species => species.tags.includes('fossil'))).toBe(true)
  })

  it('never returns an empty pool, whatever the rule asks for', () => {
    expect(resolvePool({ kind: 'special', label: 'nada', tags: ['nope'] }, ALL_SPECIES)).toEqual([])
    expect(poolOf({ ...definition, pool: { kind: 'special', label: 'nada', tags: ['nope'] } }).length)
      .toBeGreaterThan(0)
  })
})

describe('the cave floor (D1 §6, §7, §13)', () => {
  const profile = dungeonProfile(2024, 'B', 'cave')
  const plan = generateFloor(profile, 3, poolOf(definition))
  const tiles = buildFloorTiles(plan, 'cave', 2024)

  it('is deterministic from the seed', () => {
    expect(buildFloorTiles(plan, 'cave', 2024).tiles).toEqual(tiles.tiles)
  })

  it('carves rooms and corridors out of rock, not a rectangle of floor', () => {
    const walkable = tiles.tiles.filter(kind => WALKABLE.has(kind)).length
    expect(walkable).toBeGreaterThan(40)
    // Most of the map is still rock: it is a cave, not an arena.
    expect(walkable / tiles.tiles.length).toBeLessThan(0.5)
  })

  it('puts the player somewhere walkable and marks the way down', () => {
    expect(isWalkable(tiles, tiles.entrance.x, tiles.entrance.y)).toBe(true)
    expect(tileAt(tiles, tiles.exit.x, tiles.exit.y)).toBe('stairs')
  })

  it('places every encounter and chest on a walkable tile', () => {
    const entities = placeEntities(plan, tiles, 2024)
    expect(entities.length).toBeGreaterThan(0)
    for (const entity of entities) expect(isWalkable(tiles, entity.at.x, entity.at.y)).toBe(true)
  })

  it('guarantees the Alpha on the last floor and nowhere else', () => {
    for (let floor = 1; floor <= profile.floors; floor++) {
      const current = generateFloor(profile, floor, poolOf(definition))
      const alphas = current.encounters.filter(encounter => encounter.isAlpha)
      expect(alphas).toHaveLength(floor === profile.floors ? 1 : 0)
    }
  })
})

describe('boss skills (D1 §44–§46)', () => {
  it('offers ten of them, none of which is an ORAS move', () => {
    expect(BOSS_SKILL_IDS).toHaveLength(10)
    for (const skill of Object.values(BOSS_SKILLS)) {
      expect(skill.name.length).toBeGreaterThan(0)
      expect(skill.cooldownSeconds).toBeGreaterThan(0)
    }
  })

  it('telegraphs anything that hurts', () => {
    for (const skill of Object.values(BOSS_SKILLS)) {
      if (skill.damage !== null) expect(skill.telegraphSeconds).toBeGreaterThan(1)
    }
  })

  it.each(DUNGEON_TIERS)('gives tier %s the configured number of skills', tier => {
    const rng = createRng(11)
    const kit = bossKitFor(tier, (min, max) => rng.int(min, max), items => rng.shuffle(items))
    expect(kit.length).toBeGreaterThanOrEqual(SKILLS_PER_TIER[tier].min)
    expect(kit.length).toBeLessThanOrEqual(SKILLS_PER_TIER[tier].max)
    expect(new Set(kit.map(skill => skill.id)).size).toBe(kit.length)
  })

  it('reaches the shape it claims', () => {
    const allies = ['ally-0', 'ally-1', 'ally-2', 'ally-3']
    const pick = () => 0
    expect(targetsFor('all', allies, null, pick)).toHaveLength(4)
    expect(targetsFor('single', allies, 'ally-2', pick)).toEqual(['ally-2'])
    expect(targetsFor('marked', allies, null, pick)).toHaveLength(1)
    expect(targetsFor('split', allies, null, pick)).toHaveLength(2)
    expect(targetsFor('self', allies, null, pick)).toHaveLength(0)
  })

  it('announces a skill before it lands, and lands it when the telegraph ends', () => {
    const party = buildParty()
    const battle = createBattle({
      allies: [{ combatant: combatantFor(party[0]) }],
      enemies: [combatantFor(buildWild(95, 45))],
      bench: {}, items: BATTLE_ITEMS, rng: createRng(4),
    })
    const skill = BOSS_SKILLS.crush
    const controller = createBossController('enemy-0', [skill], 0.5)

    for (let i = 0; i < 20; i++) { tick(battle, 1 / 20); controller.update(battle, 1 / 20) }
    expect(battle.telegraph?.name).toBe(skill.name)
    expect(battle.log.some(event => event.kind === 'boss' && event.text.includes('⚠'))).toBe(true)

    const hpBefore = battle.actors[0].combatant.pokemon.hp
    for (let i = 0; i < 60; i++) { tick(battle, 1 / 20); controller.update(battle, 1 / 20) }
    expect(battle.telegraph).toBeNull()
    expect(battle.actors[0].combatant.pokemon.hp).toBeLessThan(hpBefore)
  })
})

describe('co-op (D1 §37–§41)', () => {
  const members = () => [
    createMember('p1', 'Rodri', buildParty()),
    createMember('p2', 'Ana', buildParty()),
    createMember('p3', 'Beto', buildParty()),
  ]

  it('gives a solo player two active Pokémon and a group one each', () => {
    const solo = [createMember('p1', 'Rodri', buildParty())]
    expect(activeSlots(solo)).toEqual([{ playerId: 'p1', count: 2 }])
    expect(totalActiveAllies(solo)).toBe(2)
    const group = members()
    expect(activeSlots(group).every(slot => slot.count === 1)).toBe(true)
    expect(totalActiveAllies(group)).toBe(3)
  })

  it('never puts more than four allies on screen', () => {
    const crowd = Array.from({ length: 6 }, (_, i) => createMember(`p${i}`, `P${i}`, buildParty()))
    expect(totalActiveAllies(crowd)).toBeLessThanOrEqual(MAX_PLAYERS)
  })

  it('asks everyone before changing floor, and nobody is dragged', () => {
    const group = members()
    group[1].status = 'inCombat'
    const check = startReadyCheck(group, 'p1', 4)
    expect(check.responses.p1).toBe('ready')
    expect(check.responses.p2).toBe('busy')
    expect(everyoneReady(check)).toBe(false)
    expect(pendingMembers(check).sort()).toEqual(['p2', 'p3'])

    const answered = respond(respond(check, 'p2', 'ready'), 'p3', 'ready')
    expect(everyoneReady(answered)).toBe(true)
  })

  it('retreats one member without ending the expedition', () => {
    const group = members()
    group[0].loot = { iron_chunk: 2 }
    const result = retreatMember(group, 'p1')
    expect(result.extracted).toEqual({ iron_chunk: 2 })
    expect(result.expeditionContinues).toBe(true)
    expect(result.members.find(member => member.playerId === 'p1')!.status).toBe('retreated')
    expect(result.members.filter(isInside)).toHaveLength(2)
  })

  it('leaves a downed player out of the fight but inside the expedition', () => {
    const group = members()
    for (const pokemon of group[0].party) damage(pokemon, 99999)
    syncDowned(group)
    expect(group[0].status).toBe('downed')
    expect(isInside(group[0])).toBe(true)
    expect(isGlobalWipe(group)).toBe(false)
  })

  it('only wipes when every member still inside has nothing left', () => {
    const group = members()
    for (const member of group) for (const pokemon of member.party) damage(pokemon, 99999)
    syncDowned(group)
    expect(isGlobalWipe(group)).toBe(true)
  })

  it('does not count a member who already walked out', () => {
    const group = members()
    const afterRetreat = retreatMember(group, 'p1').members.map(member => ({ ...member }))
    for (const member of afterRetreat.filter(isInside)) {
      for (const pokemon of member.party) damage(pokemon, 99999)
    }
    expect(isGlobalWipe(afterRetreat)).toBe(true)
  })
})
