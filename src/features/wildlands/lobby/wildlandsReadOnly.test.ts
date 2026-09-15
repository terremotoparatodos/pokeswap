import { describe, expect, it } from 'vitest'
const sources = import.meta.glob<string>(
  ['../../pokemon/domain/wildPool.ts', '../engine/wildTaps.ts', '../components/WildPokemonCard.vue'],
  { query: '?raw', import: 'default', eager: true },
)

describe('R28 world integration is read-only', () => {
  it('does not contain client mutations or unsafe HTML rendering', () => {
    for (const text of Object.values(sources)) {
      expect(text).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|functions\.invoke|v-html|innerHTML/)
    }
  })
})
