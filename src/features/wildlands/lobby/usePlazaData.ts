// usePlazaData — WildLands lobby (R26)
//
// Real PokeSwap state for the town plaza: which owned Pokémon stroll there
// (the top 10 by price, shared rule in map/domain/ownedSlots), the data their
// cards show, the activity board and the discreet toasts.
//
// Read-only (TRUST_BOUNDARY §2): it selects `slots` and `activity_feed` and
// listens to Realtime. Nothing here writes to Supabase.

import { computed, onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import { fetchRecentActivity, fetchSlots } from './api/plazaApi'
import { mergeSlotPatch, topPricedIds, type SlotPatch } from './domain/ownedSlots'
import { usePlazaRealtime } from './usePlazaRealtime'
import { devWarn } from '../../../shared/utils/devTools'
import type { ActivityFeedEntry, Slot } from '../../../shared/types/database'
import type { PlazaResident } from '../engine/plazaPokemon'
import type { PokedexEntry } from '../engine/population'
import { EMPTY_NOTICES, nextNotice, type NoticeState } from './plazaNotices'
import { availableWildPool, rollWildPool, WILD_ROTATE_MS } from '../../pokemon/domain/wildPool'

/** A swap touches two slots within milliseconds: apply them together. */
export const PATCH_BATCH_MS = 250
/** Each toast stays this long; at most one toast per interval. */
export const NOTICE_MS = 4000

export interface PlazaCard {
  pokemonId: number
  name: string
  /** Untrusted text: render with interpolation only. */
  ownerUsername: string | null
  price: number
  owned: boolean
  mine: boolean
}

export interface PlazaDataOptions {
  pokedex: Ref<readonly PokedexEntry[]>
  userId: Ref<string | null>
  /** True while a panel, the menu, sign-in or the board covers the town: toasts are dropped. */
  quiet: () => boolean
  /** Injectable only for deterministic pool/rotation tests. */
  now?: () => number
  random?: () => number
}

export function usePlazaData(options: PlazaDataOptions) {
  const slots = shallowRef<Record<number, Slot>>({})
  const loaded = ref(false)
  const loadError = ref(false)
  const notice = ref<string | null>(null)
  const wildPool = ref<readonly number[]>([])
  const wildRotateAt = ref(0)
  const now = options.now ?? Date.now

  const nameOf = (id: number) => options.pokedex.value.find(p => p.id === id)?.name_es ?? `#${id}`

  const residents = computed<PlazaResident[]>(() => {
    const me = options.userId.value
    return topPricedIds(slots.value).map(id => ({ pokemonId: id, mine: me !== null && slots.value[id].owner_id === me }))
  })
  /** Pool membership is cosmetic; this extra filter follows server ownership immediately. */
  const wildPokemonIds = computed(() => availableWildPool(wildPool.value, slots.value))

  function rotateWildPool(): void {
    if (!loaded.value || !options.pokedex.value.length) return
    wildPool.value = rollWildPool(options.pokedex.value, slots.value, { random: options.random })
    wildRotateAt.value = now() + WILD_ROTATE_MS
  }

  function card(pokemonId: number): PlazaCard {
    const slot = slots.value[pokemonId]
    const me = options.userId.value
    return {
      pokemonId,
      name: nameOf(pokemonId),
      ownerUsername: slot?.owner_username ?? null,
      price: slot?.current_price ?? 0,
      owned: !!slot?.owner_id,
      mine: me !== null && slot?.owner_id === me,
    }
  }

  // ── Toasts ───────────────────────────────────────────────────────────────────
  let notices: NoticeState = EMPTY_NOTICES
  let noticeTimer: ReturnType<typeof setTimeout> | null = null

  function showNextNotice(): void {
    noticeTimer = null
    if (options.quiet()) {
      notices = EMPTY_NOTICES
      notice.value = null
      return
    }
    const { text, rest } = nextNotice(notices, nameOf)
    notices = rest
    notice.value = text
    if (text) noticeTimer = setTimeout(showNextNotice, NOTICE_MS)
  }

  function queueNotice(change: (state: NoticeState) => NoticeState): void {
    if (options.quiet()) return
    notices = change(notices)
    if (!noticeTimer) showNextNotice()
  }

  // ── Slots ────────────────────────────────────────────────────────────────────
  /** Non-null while a fetch is in flight: patches wait here and replay on top of it. */
  let arrivedDuringFetch: SlotPatch[] | null = null
  let batch: SlotPatch[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  function apply(patches: readonly SlotPatch[], announce: boolean): void {
    const me = options.userId.value
    let next = slots.value
    for (const patch of patches) {
      const before = next[patch.pokemon_id]
      if (announce && me && before?.owner_id === me && patch.owner_id !== me) {
        const name = nameOf(patch.pokemon_id)
        queueNotice(state => ({ ...state, lost: [...state.lost, name] }))
      }
      next = mergeSlotPatch(next, patch)
    }
    slots.value = next
  }

  function flushBatch(): void {
    batchTimer = null
    const patches = batch
    batch = []
    apply(patches, true)
  }

  function onSlotPatch(patch: SlotPatch): void {
    if (arrivedDuringFetch) {
      arrivedDuringFetch.push(patch)
      return
    }
    batch.push(patch)
    if (!batchTimer) batchTimer = setTimeout(flushBatch, PATCH_BATCH_MS)
  }

  function onActivity(event: ActivityFeedEntry): void {
    if (!loaded.value) return
    queueNotice(state => ({ ...state, events: [...state.events, event] }))
  }

  const realtime = usePlazaRealtime(onSlotPatch, {
    channel: 'plaza',
    onActivity,
    // Events may have been missed while disconnected: read the current state again.
    onReconnect: () => void refresh(),
  })

  async function refresh(): Promise<void> {
    if (arrivedDuringFetch) return
    arrivedDuringFetch = []
    try {
      const [fresh, activity] = await Promise.all([fetchSlots(), fetchRecentActivity()])
      slots.value = fresh
      realtime.seedActivity(activity)
      loaded.value = true
      loadError.value = false
      if (!wildPool.value.length || now() >= wildRotateAt.value) rotateWildPool()
    } catch (error) {
      devWarn('[plaza] slots unavailable', error)
      loadError.value = true
    } finally {
      const replay = arrivedDuringFetch ?? []
      arrivedDuringFetch = null
      apply(replay, false)
    }
  }

  onMounted(() => void refresh())
  // The Pokédex arrives independently from slots on first load. Do not reroll
  // merely because an area changes; only the initial catalog or the hour does.
  watch(options.pokedex, () => {
    if (loaded.value && (!wildPool.value.length || now() >= wildRotateAt.value)) rotateWildPool()
  })
  const rotationTimer = setInterval(() => {
    if (now() >= wildRotateAt.value) rotateWildPool()
  }, 30_000)
  onUnmounted(() => {
    if (batchTimer) clearTimeout(batchTimer)
    if (noticeTimer) clearTimeout(noticeTimer)
    clearInterval(rotationTimer)
  })

  return {
    residents,
    card,
    activity: realtime.recentActivity,
    connected: realtime.connected,
    loaded,
    loadError,
    notice,
    wildPokemonIds,
    wildRotateAt,
    rotateWildPool,
    nameOf,
    refresh,
  }
}
