import { describe, expect, it } from 'vitest'
import type { ActivityFeedEntry } from '../../../shared/types/database'
import { boardEntries, EMPTY_NOTICES, nextNotice, timeAgo } from './plazaNotices'

const nameOf = (id: number) => ({ 25: 'Pikachu', 7: 'Squirtle' })[id] ?? `#${id}`
const event = (id: string, pokemon_id: number | null, type: ActivityFeedEntry['type'] = 'claim'): ActivityFeedEntry =>
  ({ id, type, user_id: 'u', pokemon_id, created_at: '2026-09-13T12:00:00Z' })

describe('nextNotice', () => {
  it('announces each lost Pokémon on its own before any activity', () => {
    const first = nextNotice({ lost: ['Pikachu', 'Squirtle'], events: [event('a', 25)] }, nameOf)
    expect(first.text).toBe('Pikachu ya no es tuyo: cambió de dueño')
    const second = nextNotice(first.rest, nameOf)
    expect(second.text).toBe('Squirtle ya no es tuyo: cambió de dueño')
    expect(nextNotice(second.rest, nameOf).text).toBe('Captura · Pikachu')
  })

  it('groups pending activity into one toast', () => {
    const { text, rest } = nextNotice({ lost: [], events: [event('a', 25), event('b', 7), event('c', null)] }, nameOf)
    expect(text).toBe('3 novedades en el tablón')
    expect(rest).toEqual(EMPTY_NOTICES)
  })

  it('has nothing to say when empty', () => {
    expect(nextNotice(EMPTY_NOTICES, nameOf).text).toBeNull()
  })
})

describe('boardEntries', () => {
  it('labels events and names their Pokémon', () => {
    const now = Date.parse('2026-09-13T12:05:00Z')
    expect(boardEntries([event('a', 25, 'free_claim'), event('b', null)], nameOf, now)).toEqual([
      { id: 'a', label: 'Gratis', pokemon: 'Pikachu', when: 'hace 5 min' },
      { id: 'b', label: 'Captura', pokemon: null, when: 'hace 5 min' },
    ])
  })
})

describe('timeAgo', () => {
  const at = '2026-09-13T12:00:00Z'
  const t = Date.parse(at)
  it.each([
    [t + 20_000, 'recién'],
    [t + 59 * 60_000, 'hace 59 min'],
    [t + 3 * 3_600_000, 'hace 3 h'],
    [t + 50 * 3_600_000, 'hace 2 d'],
    [t - 60_000, 'recién'],
  ])('at %d says %s', (now, text) => {
    expect(timeAgo(at, now)).toBe(text)
  })

  it('is empty for missing or broken dates', () => {
    expect(timeAgo(null, t)).toBe('')
    expect(timeAgo('ayer', t)).toBe('')
  })
})
