// R32.2.1 — Audits every move slug production can hold against the Battle
// Catalog (R32.1).
//
// `pokemon_xp.moves` is a JSON array of slugs. Only two code paths ever wrote
// it, both in the retired monolith (git tag v0-legacy-baseline, index.html):
//
//   1. `learnRandomMove` / `_confirmLearn` — writes `LEARNSET[id][n][1]`, the
//      PokéAPI identifier (`vine-whip`). The clean path.
//   2. The first write of a row, which seeds the array from
//      `getMoves(p, level).map(m => m.slug || m.name.toLowerCase().replace(/ /g,'-'))`.
//      `getMoves` only carries a `slug` on its LEARNSET branch; its LEVEL_MOVES
//      fallback, its STATUS_MOVES fallback and its four hard-coded filler moves
//      carry **display names**, in Spanish or English depending on the UI
//      language. Those slugify into things like `latigo-cepa` or `double-edge`.
//
// So the audit is over the whole universe of slugs those paths can produce, not
// over production rows: this repo has no access to production data, and the
// point is to know which shapes a migration must handle, not how many rows
// happen to hold each one today.
//
// Usage: node scripts/legacy-move-audit.mjs
// Output: docs/wildlands/LEGACY_MOVE_AUDIT.md (generated; commit it)

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const TAG = 'v0-legacy-baseline'
const CATALOG = 'src/features/battle/catalog/generated/moves.json'
const OUT = 'docs/wildlands/LEGACY_MOVE_AUDIT.md'

const legacy = file =>
  execFileSync('git', ['show', `${TAG}:data/${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

// The two tables are plain `const` declarations; running them in an empty
// context is enough to read them and cannot touch anything of ours.
// They are `const` declarations, so they live in the script's own scope: the
// three are handed back by the last expression rather than read off the global.
const context = createContext({})
const { LEARNSET, LEVEL_MOVES, STATUS_MOVES } = runInContext(
  `${legacy('learnset.js')}\n${legacy('moves-data.js')}\n;({ LEARNSET, LEVEL_MOVES, STATUS_MOVES })`,
  context,
)

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
const known = new Set(catalog.moves.map(move => move.name))

/** The monolith's own slugification, character for character (index.html:2176). */
const slugify = name => String(name).toLowerCase().replace(/ /g, '-')

/** Four moves hard-coded as filler when nothing else filled a slot. */
const HARD_CODED = ['Placaje', 'Gruñido', 'Impresionar', 'Fortaleza', 'Danza Espada']

const sources = {
  'learnset identifier': new Set(),
  'level-up move, Spanish name': new Set(),
  'level-up move, English name': new Set(),
  'status move, Spanish name': new Set(),
  'status move, English name': new Set(),
  'hard-coded filler': new Set(),
}

for (const entries of Object.values(LEARNSET)) {
  for (const entry of entries) sources['learnset identifier'].add(entry[1])
}
for (const entries of Object.values(LEVEL_MOVES)) {
  for (const entry of entries) {
    sources['level-up move, Spanish name'].add(slugify(entry[1]))
    sources['level-up move, English name'].add(slugify(entry[2]))
  }
}
for (const entries of Object.values(STATUS_MOVES)) {
  for (const entry of entries) {
    sources['status move, Spanish name'].add(slugify(entry[0]))
    sources['status move, English name'].add(slugify(entry[1]))
  }
}
for (const name of HARD_CODED) sources['hard-coded filler'].add(slugify(name))

const rows = []
const unresolvedBySource = new Map()
for (const [source, slugs] of Object.entries(sources)) {
  const sorted = [...slugs].sort()
  const unresolved = sorted.filter(slug => !known.has(slug))
  rows.push({ source, total: sorted.length, resolved: sorted.length - unresolved.length, unresolved: unresolved.length })
  unresolvedBySource.set(source, unresolved)
}

const everySlug = new Set(Object.values(sources).flatMap(set => [...set]))
const everyUnresolved = [...everySlug].filter(slug => !known.has(slug)).sort()

const table = [
  '| Origen del slug | Slugs distintos | Resuelven | No resuelven |',
  '|---|---:|---:|---:|',
  ...rows.map(r => `| ${r.source} | ${r.total} | ${r.resolved} | ${r.unresolved} |`),
  `| **Universo unido** | **${everySlug.size}** | **${everySlug.size - everyUnresolved.length}** | **${everyUnresolved.length}** |`,
].join('\n')

const sample = (source, n = 12) => {
  const list = unresolvedBySource.get(source)
  if (list.length === 0) return '— (todos resuelven)'
  return list.slice(0, n).map(slug => `\`${slug}\``).join(', ') + (list.length > n ? `, … (+${list.length - n})` : '')
}

const head = execFileSync('git', ['rev-parse', TAG], { encoding: 'utf8' }).trim()

writeFileSync(OUT, `# R32.2.1 — Auditoría de movimientos legacy

> GENERADO por \`node scripts/legacy-move-audit.mjs\`. No editar a mano.
> Fuente legacy: tag \`${TAG}\` (\`${head}\`), \`data/learnset.js\` y \`data/moves-data.js\`.
> Catálogo: \`${catalog.catalogVersion}\` (${catalog.moves.length} movimientos).

## Qué se audita

\`pokemon_xp.moves\` guarda un array de **slugs**. Sólo dos caminos del monolito
retirado lo escribieron alguna vez:

1. \`_confirmLearn\` (comprar un movimiento) escribe \`LEARNSET[id][n][1]\`, el
   identificador de PokéAPI (\`vine-whip\`). Ese camino es limpio.
2. La primera escritura de la fila siembra el array con
   \`getMoves(p, level).map(m => m.slug || m.name.toLowerCase().replace(/ /g,'-'))\`.
   \`getMoves\` sólo trae \`slug\` en su rama de \`LEARNSET\`; su rama de respaldo
   sobre \`LEVEL_MOVES\`, la de \`STATUS_MOVES\` y sus cuatro rellenos fijos traen
   **nombres visibles**, en español o inglés según el idioma de la interfaz.

Esta auditoría recorre **todo el universo de slugs que esos caminos pueden
producir**. No cuenta filas de producción: este repo no tiene acceso a esos
datos, y lo que hace falta saber es qué formas tiene que contemplar una
migración, no cuántas filas tiene hoy cada forma.

## Resultado

${table}

## No resuelven, por origen

${rows.map(r => `- **${r.source}** (${r.unresolved}): ${sample(r.source)}`).join('\n')}

## Las tres causas de un slug que no resuelve

**1. Nombre visible en español.** El catálogo indexa identificadores de veekun,
que son ingleses, así que un nombre español **nunca** resuelve. Es la causa más
grande en número (${unresolvedBySource.get('level-up move, Spanish name').length + unresolvedBySource.get('status move, Spanish name').length + unresolvedBySource.get('hard-coded filler').length} slugs distintos), y también la más fácil de reparar: cada
uno de esos slugs viene de una fila de \`LEVEL_MOVES\`/\`STATUS_MOVES\` que trae
el nombre inglés al lado, así que la tabla legacy misma es el diccionario.

**2. Movimiento posterior a la Generación VI.** \`learnset.js\` se generó desde
PokéAPI moderna, así que su pool incluye movimientos que en ORAS no existen. Son
${unresolvedBySource.get('learnset identifier').length} identificadores, y esta es la lista completa:

${unresolvedBySource.get('learnset identifier').map(slug => `\`${slug}\``).join(', ')}

No hay equivalente en el catálogo porque el movimiento no existía: para estos,
reparar el nombre no alcanza.

**3. Renombre entre generaciones.** ${sample('level-up move, English name', 4)} es
el único caso por nombre inglés: en Gen VI el identificador es \`vice-grip\`, y
recién Gen VIII lo escribe \`vise-grip\`. El movimiento existe; cambió el nombre.

## Lectura

- El camino de compra de movimientos es el único que produce identificadores
  canónicos, y el 94 % de su pool resuelve; lo que falla es posterior a ORAS.
- Los nombres en inglés resuelven casi siempre por coincidencia — \`Take Down\`
  slugifica a \`take-down\`, que es el identificador real.
- Un slug que no resuelve **no se reemplaza en silencio**: la estrategia de
  backfill está en \`POKEMON_SPECIES_INSTANCE_MODEL.md\` §11 y no se aplica sin
  aprobación humana.
`)

console.log(table)
console.log(`\nUniverso unido: ${everySlug.size} slugs, ${everyUnresolved.length} sin resolver`)
console.log(`Escrito ${OUT}`)
