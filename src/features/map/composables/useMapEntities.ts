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
import { mergeSlotPatch, visibleOwnedIds } from '../domain/ownedSlots'
import {
  getHearthomePoint,
  getSpawnPoint,
} from '../data/mapConfig'
import { rollWildPool, WILD_ROTATE_MS } from '../../pokemon/domain/wildPool'

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
    const visible = visibleOwnedIds(slots, userId)

    const now = Date.now()
    const wildPool = rollWildPool(pokemon, slots)
    const wildRotateAt = now + WILD_ROTATE_MS
    const entities: Record<number, MapEntity> = {}

    // Owned: only top-10 or the current user's own pokemon
    for (const p of pokemon) {
      const slot = slots[p.id]
      if (!slot?.owner_id || !visible.has(p.id)) continue

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
   * `slots` are the slots before the patch; visibility is judged after it, so
   * Pokémon that enter or leave the top 10 (not only the patched one) are
   * added or removed. Entities that stay visible keep their position.
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

    const nextSlots = mergeSlotPatch(slots, patch)
    const visible = visibleOwnedIds(nextSlots, userId)
    const next = { ...state.value.entities }
    const existing = next[pokemon_id]

    if (patch.owner_id) {
      if (visible.has(pokemon_id)) {
        // Newly owned or still owned: wild ones move to the city
        const pos = existing && !existing.isWild ? existing : getHearthomePoint()
        next[pokemon_id] = {
          id: pokemon_id, pokemon: p, slot: nextSlots[pokemon_id],
          x: pos.x, y: pos.y, isWild: false,
        }
      } else {
        delete next[pokemon_id]
      }
    } else if (existing) {
      // Became unowned — replace with a wild entity
      const pos = getSpawnPoint(p.type1)
      next[pokemon_id] = { ...existing, slot: null, x: pos.x, y: pos.y, isWild: true }
    }

    // Other owned Pokémon pushed out of (or into) the top 10 by this change
    for (const entity of Object.values(next)) {
      if (!entity.isWild && !visible.has(entity.id)) delete next[entity.id]
    }
    for (const id of visible) {
      if (next[id]) continue
      const other = pokemon.find(x => x.id === id)
      if (!other) continue
      const pos = getHearthomePoint()
      next[id] = { id, pokemon: other, slot: nextSlots[id], x: pos.x, y: pos.y, isWild: false }
    }

    state.value = { ...state.value, entities: next }
  }

  /**
   * Rotate the wild pool. Call on a 60-minute interval.
   * Removes old wild entities and spawns new ones from the updated pool.
   */
  function rotateWildPool(pokemon: Pokemon[], slots: Record<number, Slot>) {
    const newPool = rollWildPool(pokemon, slots)
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
