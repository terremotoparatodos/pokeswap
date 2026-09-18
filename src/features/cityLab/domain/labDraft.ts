// City Mapping Lab — LOCAL DRAFT (DEV only).
//
// A convenience so a browser refresh does not lose an editing session: the
// current patch is kept in this browser's localStorage. It is not the export,
// it is not shared, and nothing in the game reads it. EXPORT PATCH is the
// only way a proposal leaves the lab.

export const DRAFT_KEY = 'pokeswap.dev.cityLab.draft.v1'

export interface LabDraft {
  readonly savedAt: string
  readonly patch: string
}

export interface DraftStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function loadDraft(store: DraftStore | null): LabDraft | null {
  if (!store) return null
  try {
    const raw = store.getItem(DRAFT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<LabDraft>
    return typeof value.patch === 'string' && typeof value.savedAt === 'string' ? { savedAt: value.savedAt, patch: value.patch } : null
  } catch {
    // A corrupt or blocked draft is the same as no draft: the lab starts from the baseline.
    return null
  }
}

export function saveDraft(store: DraftStore | null, patch: string, now: Date): boolean {
  if (!store) return false
  try {
    store.setItem(DRAFT_KEY, JSON.stringify({ savedAt: now.toISOString(), patch }))
    return true
  } catch {
    return false
  }
}

export function clearDraft(store: DraftStore | null): void {
  try {
    store?.removeItem(DRAFT_KEY)
  } catch {
    // Storage blocked: there is nothing to clear.
  }
}
