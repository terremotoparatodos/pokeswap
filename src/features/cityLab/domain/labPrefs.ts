// City Mapping Lab — editor preferences (DEV only).
//
// Where the EDIT camera was, its zoom and lens, and the last palette choice.
// Browser-local conveniences, stored apart from the LOCAL DRAFT and never part
// of a patch: they describe the editor, not the map.

import type { DraftStore } from './labDraft'

export const PREFS_KEY = 'pokeswap.dev.cityLab.prefs.v1'

export interface LabPrefs {
  readonly camX?: number
  readonly camY?: number
  readonly zoom?: number
  readonly lens?: string
  readonly palette?: string
}

export function loadPrefs(store: DraftStore | null): LabPrefs {
  if (!store) return {}
  try {
    const raw = store.getItem(PREFS_KEY)
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const num = (k: string) => (typeof value[k] === 'number' && Number.isFinite(value[k]) ? { [k]: value[k] as number } : {})
    const str = (k: string) => (typeof value[k] === 'string' ? { [k]: value[k] as string } : {})
    return { ...num('camX'), ...num('camY'), ...num('zoom'), ...str('lens'), ...str('palette') }
  } catch {
    // Unreadable preferences are the same as none: the editor opens with defaults.
    return {}
  }
}

export function savePrefs(store: DraftStore | null, prefs: LabPrefs): void {
  try {
    store?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage blocked: preferences simply are not remembered.
  }
}
