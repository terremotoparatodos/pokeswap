/** ECO-COMBATANT-2: fixed, read-only legacy rows. No instance or result is persisted. */
export interface EcoSlotRow {
  pokemon_id: number
  owner_id: string | null
  is_locked: boolean | null
  first_owner_id: string | null
  owned_since: string | null
}
export interface EcoProgressionRow {
  user_id: string
  pokemon_id: number
  xp: number
  level: number
  moves: Record<string, unknown> | null
}
export interface EcoReadStore {
  slots(userId: string, pokemonId: number | null): Promise<EcoSlotRow[]>
  progressions(userId: string, ids: number[]): Promise<EcoProgressionRow[]>
}

export async function readEcoCombatants(store: EcoReadStore, userId: string, pokemonId: number | null) {
  const slots = (await store.slots(userId, pokemonId)).filter(slot => slot.owner_id === userId && (pokemonId === null || slot.pokemon_id === pokemonId))
  if (!slots.length) return []
  const progressions = await store.progressions(userId, slots.map(slot => slot.pokemon_id))
  // A single selection/start read finishes with a fresh ownership/lock read.
  // This is a point-in-time check, not a market lock or atomic promise with sales.
  const current = pokemonId === null ? slots : await store.slots(userId, pokemonId)
  return current.filter(slot => slot.owner_id === userId && slots.some(s => s.pokemon_id === slot.pokemon_id))
    .map(slot => ({
      slot: { pokemon_id: slot.pokemon_id, owner_id: slot.owner_id, is_locked: slot.is_locked,
        first_owner_id: slot.first_owner_id, owned_since: slot.owned_since },
      progression: (() => {
        const row = progressions.find(row => row.user_id === userId && row.pokemon_id === slot.pokemon_id)
        return row ? { user_id: row.user_id, pokemon_id: row.pokemon_id, xp: row.xp, level: row.level, moves: row.moves } : null
      })(),
    }))
}
