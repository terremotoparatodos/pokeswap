// Stat changes, resolved from the two pinned sources (R32.3 / Q-4).
//
// The problem this solves: the tabular source knows **which stat and by how
// much** (`move_meta_stat_changes.csv`) but never says **who receives it**.
// Growl and Swords Dance both have one row, one stat and one number; nothing
// in that table distinguishes "lower the target's Attack" from "raise my own".
// Guessing from the sign would be right most of the time, and a catalog that
// is right most of the time is worse than one that says it does not know.
//
// So: the tabular source is the authority for **stat and delta**, and the
// pinned Showdown Gen VI data — already approved in R32.1 as the semantic
// reference — answers **recipient and probability**. Then the two are
// **cross-checked**: a move only resolves when Showdown's own stat/delta set
// matches the tabular one exactly.
//
// Two things the build learnt here, both worth knowing:
//
//   1. `move_meta_stat_changes.csv` holds **present-day** values, and
//      `move_changelog.csv` does not roll stat changes back the way it rolls
//      back power and accuracy. Diamond Storm is the proof: the table says
//      Defence +2, Generation VI is +1.
//   2. Which is exactly what `data/mods/gen6/moves.ts` is for. When the pinned
//      Gen VI diff states a move's stat change itself, **it wins** and no
//      cross-check is asked for — the tabular row is known to be the later
//      value. When the diff is silent, the two must agree.
//
// A move whose entry carries handlers is conditional (Growth doubles in sun)
// and stays deferred whatever its boosts say. No effect code is copied: what
// comes out of here is PokeSwap's own metadata, run by PokeSwap's own rules.

/** Showdown's move keys have no punctuation: `swordsdance`, `kingsshield`. */
export const showdownMoveKey = name => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The tabular source's stat ids, in the vocabulary the battle rules use. */
export const STAT_BY_ID = {
  1: 'hp', 2: 'atk', 3: 'def', 4: 'spa', 5: 'spd', 6: 'spe', 7: 'accuracy', 8: 'evasion',
}

/** Stats a battle can actually stage. HP is not one of them. */
export const STAGEABLE = new Set(['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'])

/** `{ atk: 2, spe: 1 }` out of the text between a `boosts: { … }`. */
function parseBoosts(body) {
  const out = {}
  for (const match of body.matchAll(/([a-z]+)\s*:\s*(-?\d+)/g)) out[match[1]] = Number(match[2])
  return Object.keys(out).length ? out : null
}

/** The `{ … }` that starts at `from`, by brace matching. */
function blockAt(source, from) {
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const char = source[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  return null
}

/**
 * A named sub-object of a move entry: `self: { … }`, `secondary: { … }`.
 *
 * The nested `self` is lifted out **and removed** before the block's own
 * `boosts` is read. Otherwise a secondary that raises the user's stats —
 * `secondary: { chance: 10, self: { boosts: { … } } }` — would look like it
 * both raised the user's and lowered the target's, and every move of that
 * shape would be refused as ambiguous when it is not.
 */
function subBlock(block, key) {
  const at = block.indexOf(`\n\t\t${key}: {`)
  if (at < 0) return null
  let body = blockAt(block, block.indexOf('{', at))
  if (!body) return null

  let selfBoosts = null
  const selfAt = body.indexOf('self: {')
  if (selfAt >= 0) {
    const inner = blockAt(body, body.indexOf('{', selfAt))
    if (inner) {
      selfBoosts = parseBoosts(inner.match(/boosts: \{([^{}]*)\}/)?.[1] ?? '')
      body = body.slice(0, selfAt) + body.slice(selfAt + inner.length)
    }
  }
  return {
    chance: Number(body.match(/chance: (\d+)/)?.[1] ?? 0) || null,
    boosts: parseBoosts(body.match(/boosts: \{([^{}]*)\}/)?.[1] ?? ''),
    selfBoosts,
  }
}

/**
 * Reads Showdown's move data as **data**.
 *
 * The file is TypeScript with real functions in it, so it is never executed
 * and never imported: each move's literal is located by brace matching and
 * only the shapes that state a stat change are read out of it.
 */
export function parseShowdownMoves(source) {
  const moves = new Map()
  for (const match of source.matchAll(/\n\t([a-z0-9]+): \{\n/g)) {
    const start = source.indexOf('{', match.index)
    const block = blockAt(source, start)
    if (!block) continue

    moves.set(match[1], {
      target: block.match(/\n\t\ttarget: "([a-zA-Z]+)"/)?.[1] ?? null,
      boosts: parseBoosts(block.match(/\n\t\tboosts: \{([^{}]*)\}/)?.[1] ?? ''),
      self: subBlock(block, 'self'),
      secondary: subBlock(block, 'secondary'),
      // More than one secondary at once (Fire Fang: burn and flinch). Which one
      // carries the stat change is not decidable from here.
      hasSecondaries: /\n\t\tsecondaries: \[/.test(block),
      // Handlers or a volatile mean the effect is **conditional**: Growth
      // raises one stage normally and two in sun, Curse depends on the user's
      // typing. Running the unconditional half would be quietly wrong.
      hasCode: /\n\t\ton[A-Z]\w*\(|\n\t\t\tonModifyMove|\n\t\tcondition: \{|\n\t\tvolatileStatus:/.test(block),
      // `self: undefined` in a diff means "do not inherit this".
      clears: {
        self: /\n\t\tself: undefined/.test(block),
        secondary: /\n\t\tsecondary: undefined/.test(block),
      },
    })
  }
  return moves
}

/**
 * Applies the Gen VI diff over the present-day entries.
 *
 * `inherit: true` means "keep everything I do not mention", so a key the diff
 * states replaces that key whole and `undefined` deletes it. Whatever the diff
 * touched is marked `fromGenSix`, because that is what makes it authoritative
 * over a tabular row that was never rolled back.
 */
export function mergeGenSixMoves(base, genSix) {
  const merged = new Map()
  for (const [key, entry] of base) merged.set(key, { ...entry, fromGenSix: {} })

  for (const [key, patch] of genSix) {
    const current = merged.get(key) ?? { fromGenSix: {} }
    const next = { ...current, fromGenSix: { ...current.fromGenSix } }
    if (patch.clears.self) { next.self = null; next.fromGenSix.self = true }
    else if (patch.self) { next.self = patch.self; next.fromGenSix.self = true }
    if (patch.clears.secondary) { next.secondary = null; next.fromGenSix.secondary = true }
    else if (patch.secondary) { next.secondary = patch.secondary; next.fromGenSix.secondary = true }
    if (patch.boosts) { next.boosts = patch.boosts; next.fromGenSix.boosts = true }
    if (patch.hasSecondaries) next.hasSecondaries = true
    if (patch.hasCode) next.hasCode = true
    if (patch.target) next.target = patch.target
    merged.set(key, next)
  }
  return merged
}

const sameBoosts = (a, b) => {
  if (!a || !b) return false
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return keys.every(key => a[key] === b[key])
}

const asChanges = boosts => Object.entries(boosts)
  .map(([stat, stages]) => ({ stat, stages }))
  .sort((a, b) => a.stat.localeCompare(b.stat))

/**
 * What a move's stat change is, or why it cannot be said.
 *
 * `tabular` is the list of `{ stat, delta }` the tabular source records.
 * `showdown` is the merged Gen VI entry. `statChance` is the tabular
 * probability, where 0 means "always".
 *
 * Returns `{ statChanges: { recipient, chance, kind, changes, source } }` when
 * the sources settle it, or `{ reason }` when they do not.
 */
export function resolveStatChanges({ tabular, showdown, statChance }) {
  if (!tabular.length) return { reason: 'no stat change rows' }
  if (!showdown) return { reason: 'the Gen VI reference has no entry for this move' }
  if (showdown.hasSecondaries) return { reason: 'more than one secondary effect' }
  if (showdown.hasCode) return { reason: 'the stat change is conditional' }

  const candidates = [
    showdown.boosts && {
      recipient: showdown.target === 'self' ? 'user' : 'target',
      chance: 100, kind: 'direct', boosts: showdown.boosts, genSix: showdown.fromGenSix?.boosts,
    },
    showdown.self?.boosts && {
      recipient: 'user',
      chance: showdown.self.chance ?? 100,
      kind: showdown.self.chance ? 'secondary' : 'direct',
      boosts: showdown.self.boosts,
      genSix: showdown.fromGenSix?.self,
    },
    showdown.secondary?.selfBoosts && {
      recipient: 'user', chance: showdown.secondary.chance, kind: 'secondary',
      boosts: showdown.secondary.selfBoosts, genSix: showdown.fromGenSix?.secondary,
    },
    showdown.secondary?.boosts && {
      recipient: 'target', chance: showdown.secondary.chance, kind: 'secondary',
      boosts: showdown.secondary.boosts, genSix: showdown.fromGenSix?.secondary,
    },
  ].filter(Boolean)

  if (!candidates.length) {
    return { reason: 'the Gen VI reference states this effect as code, not as data' }
  }
  if (candidates.length > 1) return { reason: 'the Gen VI reference states two stat changes at once' }

  const [candidate] = candidates
  if (!candidate.chance) return { reason: 'the Gen VI reference gives no probability' }

  // When the Gen VI diff states this move's stat change, it **is** the Gen VI
  // value and the tabular row is the later one: Diamond Storm is +1 here and
  // +2 there. Otherwise the two have to agree.
  const changes = candidate.genSix ? asChanges(candidate.boosts) : tabular
    .map(change => ({ stat: change.stat, stages: change.delta }))
    .sort((a, b) => a.stat.localeCompare(b.stat))

  if (changes.some(change => !STAGEABLE.has(change.stat))) {
    return { reason: 'stat change on a stat no battle stages' }
  }

  if (!candidate.genSix) {
    const asObject = {}
    for (const change of tabular) asObject[change.stat] = change.delta
    if (!sameBoosts(asObject, candidate.boosts)) {
      return { reason: 'the two pinned sources disagree on which stats change' }
    }
    // The tabular source records 0 for "always"; anything else has to match.
    const tabularChance = statChance || 100
    if (candidate.kind === 'secondary' && tabularChance !== candidate.chance) {
      return { reason: 'the two pinned sources disagree on the probability' }
    }
  }

  return {
    statChanges: {
      recipient: candidate.recipient,
      chance: candidate.chance,
      kind: candidate.kind,
      changes,
      /** Which pinned source settled it, so a number can always be traced. */
      source: candidate.genSix ? 'gen6-diff' : 'both-sources-agree',
    },
  }
}
