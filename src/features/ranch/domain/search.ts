// Inhabitant search — Rancho
//
// Runs on the snapshot in memory: no request per keystroke. Matching ignores
// case, accents, spaces and the usual username separators, so "juan perez",
// "JuanPerez" and "juan_pérez" all find the same person.

export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_.\-·]+/g, '')
}

export interface SearchEntry<T> {
  key: string
  name: string
  item: T
}

export function buildSearchIndex<T>(items: readonly T[], nameOf: (item: T) => string): SearchEntry<T>[] {
  return items.map(item => ({ key: normalizeName(nameOf(item)), name: nameOf(item), item }))
}

/** Exact (normalized) match, for `?u=nombre` links. */
export function findByName<T>(index: readonly SearchEntry<T>[], name: string): T | null {
  const key = normalizeName(name)
  if (!key) return null
  return index.find(entry => entry.key === key)?.item ?? null
}

/** Exact matches first, then prefixes, then anywhere in the name; shorter names first. */
export function searchByName<T>(index: readonly SearchEntry<T>[], query: string, limit = 8): T[] {
  const q = normalizeName(query)
  if (!q) return []
  const hits: { rank: number; at: number; entry: SearchEntry<T> }[] = []
  for (const entry of index) {
    const at = entry.key.indexOf(q)
    if (at < 0) continue
    const rank = entry.key === q ? 0 : at === 0 ? 1 : 2
    hits.push({ rank, at, entry })
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank || a.at - b.at || a.entry.key.length - b.entry.key.length || a.entry.name.localeCompare(b.entry.name),
  )
  return hits.slice(0, limit).map(hit => hit.entry.item)
}
