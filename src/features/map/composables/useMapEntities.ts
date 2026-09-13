// useMapEntities — R16
//
// Manages the set of Pokémon entities displayed on the map.
// Entity positions are client-side only — not persisted (TRUST_BOUNDARY §2).
//
// Spawn rules (preserved from legacy):
//   Owned:  only top-10 by price or the current user's own Pokémon appear.
//           Always placed in the Hearthome zone.
//   Wild:   25 Pokémon chosen by a weighted random pool, placed by type affinity.
//           Pool rotates every 60 minutes.
//
// The module NEVER writes to any table. Ownership changes arrive via realtime
// patches (see useMapRealtime) and are applied to update entity display state.

import { ref, computed, readonly } from 'vue'
import type { Pokemon, Slot } from '../../../shared/types/database'
import type { MapEntity, SlotPatch } from '../types'
import {
  getHearthomePoint,
  getSpawnPoint,
  WILD_POOL_SIZE,
  WILD_ROTATE_MS,
} from '../data/mapConfig'

interface EntitiesState {
  entities: Record<number, MapEntity>
  wildPool: number[]
  wildRotateAt: number
}

export function useMapEntities() {
  const state = ref<EntitiesState>({
    entities: {},
    wildPool: [],
    wildRotateAt: 0,
  })

  const entities = computed(() => Object.values(state.value.entities))

  // Internal helper: top-10 pokemon IDs by current_price (for spawn visibility).
  let _top10Ids = new Set<number>()

  function _updateTop10(slots: Record<number, Slot>) {
    const sorted = Object.entries(slots)
      .filter(([, s]) => s.owner_id)
      .sort(([, a], [, b]) => (b.current_price ?? 0) - (a.current_price ?? 0))
      .slice(0, 10)
    _top10Ids = new Set(sorted.map(([id]) => Number(id)))
  }

  function _rollWildPool(pokemon: Pokemon[], slots: Record<number, Slot>): number[] {
    const available = pokemon.filter(p => !slots[p.id]?.owner_id)
    const pool: Pokemon[] = []

    while (pool.length < WILD_POOL_SIZE && available.length > 0) {
      const r = Math.random()
      let candidates: Pokemon[]
      if (r < 0.02) {
        candidates = available.filter(p => p.is_legendary)
      } else if (r < 0.14) {
        candidates = available.filter(p => !p.is_legendary && (p.base_aura ?? 0) >= 250)
      } else {
        candidates = available.filter(p => !p.is_legendary && (p.base_aura ?? 0) < 250)
      }
      if (!candidates.length) candidates = available

      const pick = candidates[Math.floor(Math.random() * candidates.length)]
      if (!pool.find(p => p.id === pick.id)) {
        pool.push(pick)
      }
      if (pool.length >= WILD_POOL_SIZE || pool.length >= available.length) break
    }

    return pool.map(p => p.id)
  }

  /**
   * (Re-)populate all entities from a fresh data load.
   * Call once after fetchMapData() completes.
   * `userId` is the current user's ID (or null for guests).
   */
  function spawnAll(
    pokemon: Pokemon[],
    slots: Record<number, Slot>,
    userId: string | null,
  ) {
    _updateTop10(slots)

    const now = Date.now()
    const wildPool = _rollWildPool(pokemon, slots)
    const wildRotateAt = now + WILD_ROTATE_MS
    const entities: Record<number, MapEntity> = {}

    // Owned: only top-10 or the current user's own pokemon
    for (const p of pokemon) {
      const slot = slots[p.id]
      if (!slot?.owner_id) continue
      const isMe = userId && slot.owner_id === userId
      if (!isMe && !_top10Ids.has(p.id)) continue

      const pos = getHearthomePoint()
      entities[p.id] = { id: p.id, pokemon: p, slot, x: pos.x, y: pos.y, isWild: false }
    }

    // Wild: pool of unowned pokemon
    for (const id of wildPool) {
      if (entities[id]) continue
      const p = pokemon.find(x => x.id === id)
      if (!p) continue
      const pos = getSpawnPoint(p.type1)
      entities[p.id] = { id: p.id, pokemon: p, slot: null, x: pos.x, y: pos.y, isWild: true }
    }

    state.value = { entities, wildPool, wildRotateAt }
  }

  /**
   * Apply a realtime slot patch received from Supabase.
   * Updates only the entity's slot data and ownership state —
   * does not move the entity on the map.
   */
  function applySlotPatch(
    patch: SlotPatch,
    pokemon: Pokemon[],
    slots: Record<number, Slot>,
    userId: string | null,
  ) {
    const { pokemon_id } = patch
    const p = pokemon.find(x => x.id === pokemon_id)
    if (!p) return

    _updateTop10(slots)
    const existing = state.value.entities[pokemon_id]
    const isOwned = !!patch.owner_id
    const isMe = !!(userId && patch.owner_id === userId)

    if (isOwned) {
      if (existing) {
        // Update slot data in place
        if (existing.isWild) {
          // Was wild, now owned — move to city if visible
          if (isMe || _top10Ids.has(pokemon_id)) {
            const pos = getHearthomePoint()
            state.value.entities[pokemon_id] = {
              ...existing,
              slot: { ...existing.slot, ...patch } as Slot,
              x: pos.x, y: pos.y, isWild: false,
            }
          } else {
            // Not top-10 and not mine — remove from map
            const next = { ...state.value.entities }
            delete next[pokemon_id]
            state.value = { ...state.value, entities: next }
          }
        } else {
          state.value.entities[pokemon_id] = {
            ...existing,
            slot: { ...existing.slot, ...patch } as Slot,
          }
        }
      } else if (isMe || _top10Ids.has(pokemon_id)) {
        // New ownership that should appear on the map
        const pos = getHearthomePoint()
        state.value.entities[pokemon_id] = {
          id: pokemon_id, pokemon: p,
          slot: { ...patch } as Slot,
          x: pos.x, y: pos.y, isWild: false,
        }
      }
    } else {
      // Became unowned — replace with a wild entity
      if (existing) {
        const pos = getSpawnPoint(p.type1)
        state.value.entities[pokemon_id] = {
          ...existing,
          slot: null,
          x: pos.x, y: pos.y, isWild: true,
        }
      }
    }
  }

  /**
   * Rotate the wild pool. Call on a 60-minute interval.
   * Removes old wild entities and spawns new ones from the updated pool.
   */
  function rotateWildPool(pokemon: Pokemon[], slots: Record<number, Slot>) {
    const newPool = _rollWildPool(pokemon, slots)
    const next = { ...state.value.entities }

    // Remove old wild entities no longer in the pool
    for (const id of state.value.wildPool) {
      if (!newPool.includes(id) && next[id]?.isWild) {
        delete next[id]
      }
    }

    // Spawn new wild entities
    for (const id of newPool) {
      if (next[id]) continue
      const p = pokemon.find(x => x.id === id)
      if (!p) continue
      const pos = getSpawnPoint(p.type1)
      next[id] = { id, pokemon: p, slot: null, x: pos.x, y: pos.y, isWild: true }
    }

    state.value = {
      entities: next,
      wildPool: newPool,
      wildRotateAt: Date.now() + WILD_ROTATE_MS,
    }
  }

  return {
    entities: readonly(entities),
    spawnAll,
    applySlotPatch,
    rotateWildPool,
  }
}
