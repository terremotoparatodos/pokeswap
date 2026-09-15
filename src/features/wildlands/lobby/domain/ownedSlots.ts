// Owned-slot rules — WildLands lobby
//
// Pure read-model rules for the plaza and its Realtime feed. No Supabase,
// Vue, or persistent writes belong here.

import type { ActivityFeedEntry, Slot } from '../../../../shared/types/database'

export interface SlotPatch {
  pokemon_id: number
  owner_id: string | null
  owner_username: string | null
  current_price: number
  is_locked: boolean | null
  aura: number | null
}

/** How many of the most expensive owned Pokémon every visitor sees. */
export const TOP_OWNED_COUNT = 10

/** Owned Pokémon ids by current_price, highest first; ties keep lower ids first. */
export function topPricedIds(slots: Readonly<Record<number, Slot>>, count = TOP_OWNED_COUNT): number[] {
  return Object.values(slots)
    .filter(s => s.owner_id)
    .sort((a, b) => (b.current_price ?? 0) - (a.current_price ?? 0) || a.pokemon_id - b.pokemon_id)
    .slice(0, count)
    .map(s => s.pokemon_id)
}

/** Returns a new slot map with patch folded in; input is never mutated. */
export function mergeSlotPatch(slots: Readonly<Record<number, Slot>>, patch: SlotPatch): Record<number, Slot> {
  const current = slots[patch.pokemon_id]
  return { ...slots, [patch.pokemon_id]: { ...emptySlot(patch.pokemon_id), ...current, ...patch } }
}

function emptySlot(pokemonId: number): Slot {
  return {
    pokemon_id: pokemonId, owner_id: null, owner_username: null, current_price: 0, claim_count: null,
    is_locked: null, last_claimed_at: null, aura: null, aura_updated_at: null, owned_since: null,
    first_owner_id: null, first_owner_username: null, energy: null, energy_updated_at: null,
    link_url: null, link_text: null, created_at: null, updated_at: null,
  }
}

const optionalString = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const optionalNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const optionalBoolean = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** Reads a slots row pushed by Realtime; malformed data is ignored. */
export function slotPatchFromRow(row: unknown): SlotPatch | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = r['pokemon_id']
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  return {
    pokemon_id: id,
    owner_id: optionalString(r['owner_id']),
    owner_username: optionalString(r['owner_username']),
    current_price: optionalNumber(r['current_price']) ?? 0,
    is_locked: optionalBoolean(r['is_locked']),
    aura: optionalNumber(r['aura']),
  }
}

/** Ids that appeared, disappeared, or stayed between two visible sets. */
export function diffIds(prev: ReadonlySet<number>, next: ReadonlySet<number>): { entered: number[]; left: number[]; kept: number[] } {
  const entered: number[] = []
  const left: number[] = []
  const kept: number[] = []
  for (const id of next) (prev.has(id) ? kept : entered).push(id)
  for (const id of prev) if (!next.has(id)) left.push(id)
  return { entered, left, kept }
}

const ACTIVITY_LABELS: Record<ActivityFeedEntry['type'], string> = {
  claim: 'Captura', steal: 'Robo', unlock_region: 'Región', unlock_legendary: 'Legendario', free_claim: 'Gratis',
}

/** Reads an activity_feed row pushed by Realtime; malformed data is ignored. */
export function activityFromRow(row: unknown): ActivityFeedEntry | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = r['id']
  const type = r['type']
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof type !== 'string') return null
  const pokemonId = optionalNumber(r['pokemon_id'])
  return { id: String(id), type: type as ActivityFeedEntry['type'], user_id: optionalString(r['user_id']), pokemon_id: pokemonId !== null && Number.isInteger(pokemonId) ? pokemonId : null, created_at: optionalString(r['created_at']) }
}

/** Short Spanish label for an activity event type; unknown types pass through. */
export function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type as ActivityFeedEntry['type']] ?? type
}
