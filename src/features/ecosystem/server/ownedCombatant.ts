/** Temporary M-1 projection of authoritative legacy rows. Never an acquisition or a write. */
import type { BattleCatalogIndex, CatalogLearnset } from '../../battle/catalog'
import { isExecutable } from '../../battle/rules'
import { createPokemonCatalogView, levelForExperience, migrateLegacySlot, readLegacyMoves, validateInstance } from '../../pokemon/model'
import type { PokemonInstance } from '../../pokemon/model'
import type { EcoProgressionRow, EcoSlotRow } from '../../../../supabase/functions/world-authority/ecoCombatantRead'

export const OWNED_ATTRIBUTE_SOURCE = 'legacy-m1-derived' as const
export type OwnedBuild =
  | { readonly ok: true; readonly instance: PokemonInstance; readonly level: number; readonly ignoredStoredLevel: number | null }
  | { readonly ok: false; readonly reason: string }

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

export function createOwnedCombatantBuilder(index: BattleCatalogIndex, learnsets: ReadonlyMap<number, CatalogLearnset>) {
  const view = createPokemonCatalogView(index, learnsets)
  return (row: unknown, ownerId: string): OwnedBuild => {
    const fail = (reason: string): OwnedBuild => ({ ok: false, reason })
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) return fail('not-player')
    if (!record(row) || !record(row.slot)) return fail('invalid-data')
    const slot = row.slot
    if (slot.owner_id !== ownerId) return fail('not-owner')
    if (!Number.isSafeInteger(slot.pokemon_id) || (slot.pokemon_id as number) < 1
      || (slot.is_locked !== false && slot.is_locked !== null)
      || (slot.first_owner_id !== null && typeof slot.first_owner_id !== 'string')
      || (slot.owned_since !== null && typeof slot.owned_since !== 'string')) return fail(slot.is_locked === true ? 'locked' : 'invalid-data')
    const xp = row.progression
    if (!record(xp)) return fail('missing-progression')
    if (xp.user_id !== ownerId || xp.pokemon_id !== slot.pokemon_id) return fail('invalid-progression-owner')
    if (!Number.isSafeInteger(xp.xp) || (xp.xp as number) < 0 || !Number.isInteger(xp.level)) return fail('invalid-progression')
    const speciesId = slot.pokemon_id as number
    const form = index.formOf(speciesId)
    if (!form) return fail('unsupported-species')
    if (!xp.moves || typeof xp.moves !== 'object') return fail('missing-moves')
    const raw = Object.values(xp.moves)
    if (!raw.length) return fail('missing-moves')
    if (raw.length > 4) return fail('invalid-move-set')
    const resolved = readLegacyMoves(xp.moves as Record<string, unknown>, view)
    if (resolved.unresolved.length) return fail('unknown-move')
    if (resolved.moves.length !== raw.length) return fail('invalid-move-set')
    const learned = learnsets.get(form.id)
    const level = levelForExperience(xp.xp as number)
    if (!learned) return fail('missing-learnset')
    for (const { moveId } of resolved.moves) {
      if (!learned.level.some(([id, at]) => id === moveId && at <= level)
        && !learned.machine.includes(moveId) && !learned.egg.includes(moveId) && !learned.tutor.includes(moveId)) return fail('illegal-move')
      const move = index.move(moveId)
      if (!move || !isExecutable(move)) return fail('unsupported-move')
    }
    try {
      const result = migrateLegacySlot({ slot: slot as unknown as EcoSlotRow, progressions: [xp as unknown as EcoProgressionRow] }, view, {
        // Projection provenance, not an acquisition time or invented historical attributes.
        at: '2026-10-11T00:00:00.000Z', catalogVersion: index.catalogVersion,
      })
      if (result.kind !== 'migrated') return fail('not-owner')
      const instance = { ...result.draft, instanceId: `legacy-slot:${speciesId}` }
      if (validateInstance(instance, view).length) return fail('invalid-instance')
      return { ok: true, instance: freeze(instance), level, ignoredStoredLevel: result.report.ignoredStoredLevel }
    } catch {
      return fail('invalid-instance')
    }
  }
}
