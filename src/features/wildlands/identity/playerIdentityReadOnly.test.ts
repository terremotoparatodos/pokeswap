import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob<string>(
  [
    './playerCharacters.ts',
    './playerPreferences.ts',
    './playerPreferencesStore.ts',
    './playerIdentity.ts',
    './townPosition.ts',
    './usePlayerIdentity.ts',
    '../engine/companion.ts',
    '../engine/playerAppearance.ts',
    '../engine/playerNameplate.ts',
    '../components/PlayerIdentitySection.vue',
  ],
  { query: '?raw', import: 'default', eager: true },
)

const FORBIDDEN = [
  /\.insert\s*\(/, /\.upsert\s*\(/, /\.update\s*\(\s*\{/, /\.delete\s*\(\s*\)/,
  /\.rpc\s*\(/, /functions\s*\.\s*invoke/, /innerHTML|v-html/, /console\s*\./,
]

describe('R27 identity modules stay cosmetic and safe', () => {
  it('finds every identity source', () => {
    expect(Object.keys(SOURCES)).toHaveLength(10)
  })

  it.each(Object.entries(SOURCES))('%s has no database write, raw HTML or console call', (_path, source) => {
    for (const pattern of FORBIDDEN) expect(source, String(pattern)).not.toMatch(pattern)
    expect(source).not.toMatch(/shared\/api\/supabase/)
  })
})
