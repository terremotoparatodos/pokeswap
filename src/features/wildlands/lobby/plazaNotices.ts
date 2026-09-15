// Plaza notices — WildLands lobby (R26)
//
// Text for the discreet toasts and the activity board. Pure functions: the
// view renders every string with text interpolation (INV-ID-4), never as HTML.

import { activityLabel } from './domain/ownedSlots'
import type { ActivityFeedEntry } from '../../../shared/types/database'

export interface NoticeState {
  /** Names of the viewer's Pokémon that changed owner, oldest first. */
  lost: readonly string[]
  /** Activity rows not yet announced. */
  events: readonly ActivityFeedEntry[]
}

export const EMPTY_NOTICES: NoticeState = { lost: [], events: [] }

/**
 * The next toast and what is left to announce. Losing one of your own Pokémon
 * is announced on its own; pending activity is grouped into a single toast.
 */
export function nextNotice(state: NoticeState, nameOf: (id: number) => string): { text: string | null; rest: NoticeState } {
  const [lost, ...otherLost] = state.lost
  if (lost !== undefined) return { text: `${lost} ya no es tuyo: cambió de dueño`, rest: { ...state, lost: otherLost } }
  if (state.events.length === 1) return { text: `${activityLabel(state.events[0].type)} · ${eventTarget(state.events[0], nameOf)}`, rest: EMPTY_NOTICES }
  if (state.events.length > 1) return { text: `${state.events.length} novedades en el tablón`, rest: EMPTY_NOTICES }
  return { text: null, rest: EMPTY_NOTICES }
}

function eventTarget(event: ActivityFeedEntry, nameOf: (id: number) => string): string {
  return event.pokemon_id !== null ? nameOf(event.pokemon_id) : 'PokeSwap'
}

export interface BoardEntry {
  id: string
  label: string
  pokemon: string | null
  when: string
}

export function boardEntries(events: readonly ActivityFeedEntry[], nameOf: (id: number) => string, now: number): BoardEntry[] {
  return events.map(e => ({
    id: e.id,
    label: activityLabel(e.type),
    pokemon: e.pokemon_id !== null ? nameOf(e.pokemon_id) : null,
    when: timeAgo(e.created_at, now),
  }))
}

/** "recién", "hace 5 min", "hace 3 h", "hace 2 d"; empty for missing or unreadable dates. */
export function timeAgo(iso: string | null, now: number): string {
  const at = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(at)) return ''
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} d`
}
