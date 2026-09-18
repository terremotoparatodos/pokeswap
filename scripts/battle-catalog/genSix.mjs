// Rolling species data back to Generation VI (R32.1).
//
// The tabular source records **today's** base stats and ability slots: Arbok,
// Pelipper, Volbeat, Torkoal and two dozen others were buffed after ORAS, and
// Gengar lost Levitate in Gen VII. Nothing in those CSVs remembers what the
// values used to be, so on their own the catalog would quietly ship Gen VII
// numbers under a Gen VI label.
//
// The pinned `data/mods/gen6/pokedex.ts` of Pokémon Showdown (MIT) is exactly
// that diff — the recorded set of species whose stats, abilities or types
// differ in Gen VI — so the build reads it and applies those overrides. Only
// the data is used; no battle code is copied.
//
// The file is a plain object literal, so it is parsed as data and never
// executed as part of the app.

/** Showdown's species keys have no punctuation: `nidoranf`, `charizardmegax`. */
export const showdownKey = name => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** `Lightning Rod` → `lightning-rod`, the identifier the tabular source uses. */
export const abilitySlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/**
 * Reads the Gen VI diff into `{ key: { baseStats?, abilities?, types? } }`.
 *
 * The source is TypeScript, but the body is a literal: the type import and the
 * `export const … =` header are stripped and the rest is parsed by the JS
 * engine as an expression. No module of theirs is loaded.
 */
export function parseGenSixDiff(source) {
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('gen6 pokedex: no object literal found')
  const literal = source.slice(start, end + 1)
  if (/\b(require|import|process|eval|function)\b/.test(literal)) {
    throw new Error('gen6 pokedex: the body is not a plain data literal any more; review before trusting it')
  }
  // A pinned, hash-checked data literal, parsed at build time only.
  const table = new Function(`return (${literal})`)()

  const out = new Map()
  for (const [key, entry] of Object.entries(table)) {
    const patch = {}
    if (entry.baseStats) {
      const { hp, atk, def, spa, spd, spe } = entry.baseStats
      patch.baseStats = [hp, atk, def, spa, spd, spe]
    }
    if (entry.abilities) {
      patch.abilities = {
        slot1: entry.abilities['0'] ? abilitySlug(entry.abilities['0']) : null,
        slot2: entry.abilities['1'] ? abilitySlug(entry.abilities['1']) : null,
        hidden: entry.abilities.H ? abilitySlug(entry.abilities.H) : null,
      }
    }
    if (entry.types) patch.types = entry.types.map(type => type.toLowerCase())
    if (Object.keys(patch).length) out.set(key, patch)
  }
  return out
}
