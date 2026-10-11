import { beforeAll, describe, expect, it } from 'vitest'
import { loadBattleCatalog, loadLearnsets, type BattleCatalogIndex } from '../../battle/catalog'
import { experienceForLevel } from '../../pokemon/model'
import { createOwnedCombatantBuilder } from './ownedCombatant'
import { prepareEncounterBattles } from './encounterBattleRuntime'

const A = '11111111-1111-4111-8111-111111111111'
const row = (species = 25, moves: unknown = ['thunder-shock', 'quick-attack']) => ({
  slot: { pokemon_id: species, owner_id: A, is_locked: false, first_owner_id: A, owned_since: null },
  progression: { user_id: A, pokemon_id: species, xp: experienceForLevel(12), level: 99, moves },
})
let build: ReturnType<typeof createOwnedCombatantBuilder>
let index: BattleCatalogIndex
beforeAll(async () => { index = await loadBattleCatalog(); build = createOwnedCombatantBuilder(index, await loadLearnsets()) })

describe('temporary owned M-1 construction', () => {
  it('preserves authoritative XP/moves, derives the existing M-1 fields, and is stable without a reroll', () => {
    const input = row()
    const before = structuredClone(input)
    const result = build(input, A)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.level).toBe(12)
    expect(result.ignoredStoredLevel).toBe(99)
    expect(result.instance.experience).toBe(input.progression.xp)
    expect(result.instance.instanceId).toBe('legacy-slot:25')
    expect(result.instance.ownership.ownerId).toBe(A)
    expect(result.instance.acquisition.source).toBe('legacy_migration')
    expect(result.instance.moves.map(move => index.move(move.moveId)?.name)).toEqual(['thunder-shock', 'quick-attack'])
    expect(Object.isFrozen(result.instance.ivs)).toBe(true)
    expect(build(input, A)).toEqual(result)
    expect(input).toEqual(before)
  })

  it('does not borrow missing/former owner progression or accept synthetic identities and locks', () => {
    expect(build({ ...row(), progression: null }, A)).toEqual({ ok: false, reason: 'missing-progression' })
    const wrong = row(); wrong.progression.user_id = 'former-owner'
    expect(build(wrong, A)).toEqual({ ok: false, reason: 'invalid-progression-owner' })
    expect(build(row(), 'benchmark-a')).toEqual({ ok: false, reason: 'not-player' })
    const locked = row(); locked.slot.is_locked = true
    expect(build(locked, A)).toEqual({ ok: false, reason: 'locked' })
    expect(build({ ...row(), progression: { ...row().progression, xp: NaN } }, A)).toEqual({ ok: false, reason: 'invalid-progression' })
  })

  it('rejects whole malformed, unknown, illegal, unsupported or empty sets without silent repairs', () => {
    for (const moves of [null, [], {}]) expect(build(row(25, moves), A)).toEqual({ ok: false, reason: 'missing-moves' })
    expect(build(row(25, ['made-up', 'quick-attack']), A)).toEqual({ ok: false, reason: 'unknown-move' })
    expect(build(row(25, ['quick-attack', 'quick-attack']), A)).toEqual({ ok: false, reason: 'invalid-move-set' })
    expect(build(row(25, Array(5).fill('quick-attack')), A)).toEqual({ ok: false, reason: 'invalid-move-set' })
    expect(build(row(25, ['vine-whip']), A)).toEqual({ ok: false, reason: 'illegal-move' })
    const unsupported = index.catalog.moves.find(move => !move.supported)
    expect(unsupported).toBeDefined()
    if (unsupported) {
      const fakeSets = new Map([[25, { level: [[unsupported.id, 1]] as const, machine: [], tutor: [], egg: [] }]])
      expect(createOwnedCombatantBuilder(index, fakeSets)(row(25, [unsupported.name]), A)).toEqual({ ok: false, reason: 'unsupported-move' })
    }
  })

  it('the real authority accepts an owned projection and never falls back when owned rows fail', async () => {
    const prepared = await prepareEncounterBattles()
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const start = { battleId: 'owned-test', controllerId: A, speciesId: 19, seed: 1, mode: 'owned' as const, ownedRow: row() }
    const battle = prepared.battles.start(start)
    expect(battle.ok).toBe(true)
    if (battle.ok) {
      const c = battle.battle.snapshot().combatants['player-0']!
      expect(c.instance.instanceId).toBe('legacy-slot:25')
      expect(c.level).toBe(12)
    }
    expect(prepared.battles.start({ ...start, ownedRow: undefined }).ok).toBe(false)
    expect(prepared.battles.start({ ...start, ownedRow: row(25, ['made-up']) }).ok).toBe(false)
    expect(prepared.battles.start({ ...start, mode: 'synthetic', ownedRow: undefined }).ok).toBe(true)
  })
})
