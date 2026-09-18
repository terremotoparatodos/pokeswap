// R32.2.1 — Classifies every move slug production can hold against the Battle
// Catalog (R32.1), and generates the canonicalization layer the migration uses.
//
// `pokemon_xp.moves` is a JSON array of slugs. Only two code paths ever wrote
// it, both in the retired monolith (git tag v0-legacy-baseline, index.html):
//
//   1. `learnRandomMove` / `_confirmLearn` — writes `LEARNSET[id][n][1]`, the
//      PokéAPI identifier (`vine-whip`). The clean path.
//   2. The first write of a row, which seeds the array from
//      `getMoves(p, level).map(m => m.slug || m.name.toLowerCase().replace(/ /g,'-'))`.
//      `getMoves` only carries a `slug` on its LEARNSET branch; its LEVEL_MOVES
//      fallback, its STATUS_MOVES fallback and its five hard-coded filler moves
//      carry **display names**, in Spanish or English depending on the UI
//      language. Those slugify into things like `latigo-cepa` or `double-edge`.
//
// A slug that does not resolve is **not** one problem but four, and they need
// different answers:
//
//   A EXACT            resolves directly against the catalog.
//   B CANONICALIZABLE  the same move under another name — Spanish display name,
//                      historical spelling, old alias. It is preserved, never
//                      replaced: this script emits the map that repairs it.
//   C INCOMPATIBLE     the move genuinely does not exist in ORAS / Gen VI.
//                      Proven with veekun's own `generation_id`, not asserted.
//   D UNKNOWN          cannot be identified unambiguously. Never guessed at.
//
// The dictionary for B is the legacy data itself: LEVEL_MOVES and STATUS_MOVES
// carry the Spanish and the English name of each move side by side, so nothing
// here is a hand-written translation table. Only genuine historical renames
// need an explicit alias, and there is exactly one.
//
// Usage: node scripts/legacy-move-audit.mjs   (needs npm run catalog:fetch)
// Output: docs/wildlands/LEGACY_MOVE_AUDIT.md                     (generated)
//         src/features/pokemon/model/generated/legacyMoves.json   (generated)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

import { readTable } from './battle-catalog/lib/csv.mjs'

const TAG = 'v0-legacy-baseline'
const CATALOG = 'src/features/battle/catalog/generated/moves.json'
const VEEKUN_MOVES = 'node_modules/.cache/battle-catalog/moves.csv'
const OUT_DOC = 'docs/wildlands/LEGACY_MOVE_AUDIT.md'
const OUT_MAP = 'src/features/pokemon/model/generated/legacyMoves.json'

/**
 * Historical renames: the same move, spelled differently in another generation.
 * Deliberately tiny and verifiable — every entry is a documented rename, not a
 * translation and not a guess. Anything needing more belongs in category D
 * until a human looks at it.
 */
const HISTORICAL_ALIASES = {
  // Gen I–VII `vice-grip`; Gen VIII renamed it `vise-grip`. The legacy learnset
  // was generated from a modern PokéAPI, so it carries the newer spelling.
  'vise-grip': 'vice-grip',
}

/** Five moves hard-coded as filler when nothing else filled a slot. */
const HARD_CODED = ['Placaje', 'Gruñido', 'Impresionar', 'Fortaleza', 'Danza Espada']

const legacy = file =>
  execFileSync('git', ['show', `${TAG}:data/${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

// The tables are plain `const` declarations, so running them in an empty
// context cannot touch anything of ours; the last expression hands them back.
const { LEARNSET, LEVEL_MOVES, STATUS_MOVES } = runInContext(
  `${legacy('learnset.js')}\n${legacy('moves-data.js')}\n;({ LEARNSET, LEVEL_MOVES, STATUS_MOVES })`,
  createContext({}),
)

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
const catalogId = new Map(catalog.moves.map(move => [move.name, move.id]))

if (!existsSync(VEEKUN_MOVES)) {
  console.error(`Falta ${VEEKUN_MOVES}. Corré: npm run catalog:fetch`)
  process.exit(1)
}
// veekun's own generation for every move that has ever existed: this is what
// turns "we cannot resolve it" into "it did not exist in Gen VI".
const veekunGeneration = new Map(
  readTable(readFileSync(VEEKUN_MOVES, 'utf8')).map(row => [row.identifier, Number(row.generation_id)]),
)

/** The last generation the pinned veekun snapshot knows about. */
const VEEKUN_COVERS = Math.max(...veekunGeneration.values())

/** The monolith's own slugification, character for character (index.html:2176). */
const slugify = name => String(name).toLowerCase().replace(/ /g, '-')

// ── The universe of slugs, by the path that can write it ────────────────────

const sources = {
  'learnset identifier': new Set(),
  'level-up move, Spanish name': new Set(),
  'level-up move, English name': new Set(),
  'status move, Spanish name': new Set(),
  'status move, English name': new Set(),
  'hard-coded filler': new Set(),
}

/** legacy slug → the English display name the legacy tables pair it with. */
const englishOf = new Map()
/** Slugs whose legacy tables disagree about which move they are. */
const ambiguous = new Map()

const pair = (spanish, english) => {
  const from = slugify(spanish)
  const to = slugify(english)
  const seen = englishOf.get(from)
  if (seen && seen !== to) {
    const list = ambiguous.get(from) ?? new Set([seen])
    list.add(to)
    ambiguous.set(from, list)
    return
  }
  englishOf.set(from, to)
}

for (const entries of Object.values(LEARNSET)) {
  for (const entry of entries) sources['learnset identifier'].add(entry[1])
}
for (const entries of Object.values(LEVEL_MOVES)) {
  for (const entry of entries) {
    sources['level-up move, Spanish name'].add(slugify(entry[1]))
    sources['level-up move, English name'].add(slugify(entry[2]))
    pair(entry[1], entry[2])
  }
}
for (const entries of Object.values(STATUS_MOVES)) {
  for (const entry of entries) {
    sources['status move, Spanish name'].add(slugify(entry[0]))
    sources['status move, English name'].add(slugify(entry[1]))
    pair(entry[0], entry[1])
  }
}
for (const name of HARD_CODED) sources['hard-coded filler'].add(slugify(name))

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Resolves one legacy slug to a catalog move id, and says how.
 *
 * The order matters: an exact hit always wins, then the legacy table's own
 * English name, then a documented historical rename. Nothing else is tried —
 * no fuzzy matching, no edit distance, no "closest" move.
 */
function classify(slug) {
  if (catalogId.has(slug)) return { kind: 'exact', moveId: catalogId.get(slug) }

  if (ambiguous.has(slug)) {
    return { kind: 'unknown', why: `legacy lo empareja con ${[...ambiguous.get(slug)].map(name => `\`${name}\``).join(' y ')}` }
  }

  const english = englishOf.get(slug)
  if (english) {
    if (catalogId.has(english)) {
      return { kind: 'canonical', moveId: catalogId.get(english), via: `nombre inglés \`${english}\`` }
    }
    const renamed = HISTORICAL_ALIASES[english]
    if (renamed && catalogId.has(renamed)) {
      return { kind: 'canonical', moveId: catalogId.get(renamed), via: `nombre inglés \`${english}\` → alias \`${renamed}\`` }
    }
  }

  const renamed = HISTORICAL_ALIASES[slug]
  if (renamed && catalogId.has(renamed)) {
    return { kind: 'canonical', moveId: catalogId.get(renamed), via: `alias histórico \`${renamed}\`` }
  }

  const generation = veekunGeneration.get(slug) ?? (english ? veekunGeneration.get(english) : undefined)
  if (generation !== undefined && generation > 6) {
    return { kind: 'incompatible', generation, why: `introducido en la generación ${generation}` }
  }
  if (generation !== undefined) {
    return { kind: 'unknown', why: `existe en veekun (gen ${generation}) pero no está en el catálogo ORAS` }
  }
  return {
    kind: 'unknown',
    why: `ausente de veekun, que cubre hasta la generación ${VEEKUN_COVERS}`,
  }
}

const everySlug = [...new Set(Object.values(sources).flatMap(set => [...set]))].sort()
const verdict = new Map(everySlug.map(slug => [slug, classify(slug)]))

const of = kind => everySlug.filter(slug => verdict.get(slug).kind === kind)
const exact = of('exact')
const canonical = of('canonical')
const incompatible = of('incompatible')
const unknown = of('unknown')

// ── The generated canonicalization map ──────────────────────────────────────

const aliases = {}
for (const slug of canonical) aliases[slug] = verdict.get(slug).moveId

const legacyHead = execFileSync('git', ['rev-parse', TAG], { encoding: 'utf8' }).trim()

mkdirSync('src/features/pokemon/model/generated', { recursive: true })
writeFileSync(OUT_MAP, `${JSON.stringify({
  note: 'GENERATED by scripts/legacy-move-audit.mjs — do not edit by hand.',
  catalogVersion: catalog.catalogVersion,
  legacyTag: TAG,
  legacyCommit: legacyHead,
  historicalAliases: HISTORICAL_ALIASES,
  aliases,
  incompatible: Object.fromEntries(incompatible.map(slug => [slug, verdict.get(slug).generation])),
}, null, 2)}\n`)

// ── The document ────────────────────────────────────────────────────────────

const bySource = Object.entries(sources).map(([source, slugs]) => {
  const list = [...slugs]
  const count = kind => list.filter(slug => verdict.get(slug).kind === kind).length
  return {
    source,
    total: list.length,
    exact: count('exact'),
    canonical: count('canonical'),
    incompatible: count('incompatible'),
    unknown: count('unknown'),
  }
})

const table = [
  '| Origen del slug | Slugs | A exactos | B canonicalizables | C incompatibles | D desconocidos |',
  '|---|---:|---:|---:|---:|---:|',
  ...bySource.map(r => `| ${r.source} | ${r.total} | ${r.exact} | ${r.canonical} | ${r.incompatible} | ${r.unknown} |`),
  `| **Universo unido** | **${everySlug.length}** | **${exact.length}** | **${canonical.length}** | **${incompatible.length}** | **${unknown.length}** |`,
].join('\n')

const list = (slugs, n = 14) =>
  slugs.length === 0
    ? '—'
    : slugs.slice(0, n).map(slug => `\`${slug}\``).join(', ') + (slugs.length > n ? `, … (+${slugs.length - n})` : '')

const exampleCanonical = canonical
  .filter(slug => verdict.get(slug).via.startsWith('nombre inglés'))
  .slice(0, 6)
  .map(slug => `| \`${slug}\` | ${verdict.get(slug).via} | ${verdict.get(slug).moveId} |`)
  .join('\n')

writeFileSync(OUT_DOC, `# R32.2.1 — Auditoría de movimientos legacy

> GENERADO por \`node scripts/legacy-move-audit.mjs\`. No editar a mano.
> Fuente legacy: tag \`${TAG}\` (\`${legacyHead}\`), \`data/learnset.js\` y \`data/moves-data.js\`.
> Catálogo: \`${catalog.catalogVersion}\` (${catalog.moves.length} movimientos).
> Generación de cada movimiento: \`moves.csv\` de veekun, la misma fuente fijada de R32.1.

## Qué se audita

\`pokemon_xp.moves\` guarda un array de **slugs**. Sólo dos caminos del monolito
retirado lo escribieron alguna vez:

1. \`_confirmLearn\` (comprar un movimiento) escribe \`LEARNSET[id][n][1]\`, el
   identificador de PokéAPI (\`vine-whip\`). Ese camino es limpio.
2. La primera escritura de la fila siembra el array con
   \`getMoves(p, level).map(m => m.slug || m.name.toLowerCase().replace(/ /g,'-'))\`.
   \`getMoves\` sólo trae \`slug\` en su rama de \`LEARNSET\`; su rama de respaldo
   sobre \`LEVEL_MOVES\`, la de \`STATUS_MOVES\` y sus cinco rellenos fijos traen
   **nombres visibles**, en español o inglés según el idioma de la interfaz.

Esta auditoría recorre **todo el universo de slugs que esos caminos pueden
producir**. No cuenta filas de producción: este repo no tiene acceso a esos
datos, y lo que hace falta saber es qué formas tiene que contemplar una
migración.

## Las cuatro categorías

| | Categoría | Qué significa | Qué hace la migración |
|---|---|---|---|
| **A** | Exacto | El slug ya es un identificador del catálogo | Lo usa tal cual |
| **B** | Canonicalizable | Es **el mismo movimiento** con otro nombre: español, alias histórico, spelling viejo | Lo **preserva**, traduciéndolo a su \`moveId\` canónico |
| **C** | Incompatible con el ruleset | El movimiento realmente no existe en ORAS / Gen VI | Lo marca como incompatibilidad real |
| **D** | Desconocido / corrupto | No se puede identificar sin ambigüedad | Lo separa; nadie adivina |

**B no es backfill.** Un movimiento escrito en español no se reemplaza por otro
movimiento: se **reconoce**. El backfill por learnset queda sólo para C y D, y
no se aplica sin aprobación humana.

## Resultado

${table}

Después de canonicalizar A + B quedan **${incompatible.length + unknown.length} slugs** sin identidad en el catálogo:
**${incompatible.length} incompatibilidades reales de ruleset** y **${unknown.length} desconocidos**.

## B — cómo se canonicaliza (${canonical.length})

El diccionario es **la propia tabla legacy**: \`LEVEL_MOVES\` y \`STATUS_MOVES\`
guardan el nombre español y el inglés en la misma fila, así que el español se
resuelve por su par inglés y de ahí al identificador del catálogo. No hay
ninguna traducción escrita a mano.

| Slug legacy | Se reconoce por | moveId |
|---|---|---:|
${exampleCanonical || '| — | — | — |'}

Sólo los renombres históricos necesitan un alias explícito, y hay exactamente ${Object.keys(HISTORICAL_ALIASES).length}:

${Object.entries(HISTORICAL_ALIASES).map(([from, to]) => `- \`${from}\` → \`${to}\`: Gen VIII renombró el identificador; en Gen VI es el segundo.`).join('\n')}

El mapa generado vive en \`src/features/pokemon/model/generated/legacyMoves.json\`
(${Object.keys(aliases).length} entradas) y lo consume \`legacy.ts\`. Se regenera con este mismo script.

## C — incompatibilidades reales de ruleset (${incompatible.length})

Probadas con el \`generation_id\` de veekun, no afirmadas: cada uno de estos
movimientos se introdujo después de la Generación VI, así que no existe en ORAS
y ningún renombre lo arregla.

${incompatible.length === 0 ? '—' : incompatible.map(slug => `\`${slug}\` (gen ${verdict.get(slug).generation})`).join(', ')}

## D — desconocidos / corruptos (${unknown.length})

${unknown.length === 0 ? 'Ninguno: todo slug del universo queda identificado o probado incompatible.' : `No se puede decidir qué son con las fuentes fijadas de R32.1: la instantánea de veekun cubre hasta la generación ${VEEKUN_COVERS} y ninguno aparece ahí. Casi con seguridad son posteriores —el \`learnset.js\` legacy se generó desde una PokéAPI moderna—, pero eso es inferencia y no prueba, así que quedan separados de C.

${unknown.map(slug => `- \`${slug}\``).join('\n')}`}

## A — exactos (${exact.length})

${list(exact, 10)}

## Lectura

- El camino de compra de movimientos produce identificadores canónicos; lo que
  falla ahí es exclusivamente posterior a ORAS.
- Los nombres en inglés resuelven casi siempre por coincidencia — \`Take Down\`
  slugifica a \`take-down\`, que es el identificador real.
- Un slug que no resuelve **no se reemplaza en silencio** en ningún caso.
`)

console.log(table)
console.log(`\nA ${exact.length} · B ${canonical.length} · C ${incompatible.length} · D ${unknown.length}`)
console.log(`Escrito ${OUT_DOC} y ${OUT_MAP}`)
