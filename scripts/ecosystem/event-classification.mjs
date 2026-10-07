// F4: reproducible, offline classification from explicit upstream flags, never heuristics.
// node scripts/ecosystem/event-classification.mjs [--check]
// Input is the exact pinned PokéAPI CSV, retained with its BSD license.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const SOURCE_COMMIT = 'bc92d3b6029ef1abe9e7ad424c400b338f3c11fe'
export const SOURCE_SHA256 = 'e66e2eeb25fd3836b0ebab6bf87bbf01960aa3c0555e2bac495fa8393c5e0c45'
export const SOURCE_URL = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${SOURCE_COMMIT}/data/v2/csv/pokemon_species.csv`
const input = fileURLToPath(new URL('./sources/pokemon_species.csv', import.meta.url))
const corePath = fileURLToPath(new URL('../../src/features/battle/catalog/generated/core.json', import.meta.url))
export const OUTPUT = fileURLToPath(new URL('../../src/features/ecosystem/encounters/eventClassification.generated.json', import.meta.url))

export async function buildEventClassification(source, core) {
  source ??= await readFile(input)
  core ??= JSON.parse(await readFile(corePath, 'utf8'))
  if (createHash('sha256').update(source).digest('hex') !== SOURCE_SHA256) throw new Error('event classification source hash mismatch')
  const lines = source.toString('utf8').trimEnd().split(/\r?\n/)
  const header = lines.shift().split(',')
  const column = name => { const i = header.indexOf(name); if (i < 0) throw new Error(`missing column ${name}`); return i }
  const [idCol, nameCol, legendaryCol, mythicalCol] = ['id', 'identifier', 'is_legendary', 'is_mythical'].map(column)
  const byId = new Map()
  for (const line of lines) {
    const row = line.split(',')
    const id = Number(row[idCol])
    if (!Number.isInteger(id) || byId.has(id)) throw new Error(`invalid/duplicate upstream species ${id}`)
    byId.set(id, row)
  }
  const species = core.species.map(s => {
    const row = byId.get(s.id)
    if (!row || row[nameCol] !== s.name) throw new Error(`classification coverage/name mismatch for ${s.id}`)
    if (![row[legendaryCol], row[mythicalCol]].every(v => v === '0' || v === '1')) throw new Error(`invalid event flags for ${s.id}`)
    return [s.id, s.name, Number(row[legendaryCol]), Number(row[mythicalCol])]
  }).sort((a, b) => a[0] - b[0])
  if (species.length !== 493 || new Set(species.map(s => s[0])).size !== 493) throw new Error('expected the unchanged 493-species battle catalog')
  return JSON.stringify({ source: { repository: 'https://github.com/PokeAPI/pokeapi', commit: SOURCE_COMMIT, url: SOURCE_URL, sha256: SOURCE_SHA256, license: 'BSD-3-Clause' }, columns: ['speciesId', 'speciesName', 'isLegendary', 'isMythical'], species }) + '\n'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fresh = await buildEventClassification()
  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e })
    if (current === null || current.replace(/\r\n/g, '\n') !== fresh) throw new Error('eventClassification.generated.json is missing or stale')
    console.log('event classification is up to date (493 species)')
  } else { await writeFile(OUTPUT, fresh); console.log('wrote event classification (493 species)') }
}
