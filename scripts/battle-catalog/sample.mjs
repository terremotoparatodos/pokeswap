// The human gate sample for R32.1.
//
//   npm run catalog:sample
//
// Prints the species and moves a person asked to check by eye before the
// catalog is trusted: typing, stats, catch rate, abilities, a slice of the
// learnset, and one move of each shape the battle rules will have to run.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', '..', 'src', 'features', 'battle', 'catalog', 'generated')
const read = async name => JSON.parse(await readFile(join(OUT, name), 'utf8'))

const SPECIES = [
  ['pikachu', 'the one everyone can check from memory'],
  ['charizard', 'two types, and megas in Gen VI'],
  ['gengar', 'ghost/poison, fast special attacker'],
  ['clefairy', 'became Fairy in Gen VI'],
  ['magnemite', 'became Electric/Steel in Gen VI'],
  ['azumarill', 'became Water/Fairy in Gen VI'],
  ['deoxys', 'edge case: four forms, each with its own stats'],
  ['shuckle', 'the slow extreme'],
  ['ninjask', 'the fast extreme'],
]

const MOVES = [
  ['tackle', 'damaging physical'],
  ['flamethrower', 'damaging special, with a burn chance'],
  ['thunder-wave', 'status'],
  ['quick-attack', 'priority'],
  ['hyper-beam', 'recharge'],
  ['protect', 'Protect-like'],
  ['bullet-seed', 'multi-hit'],
  ['giga-drain', 'drain'],
  ['double-edge', 'recoil'],
  ['seismic-toss', 'variable power'],
  ['swords-dance', 'stat change'],
  ['guillotine', 'OHKO'],
]

const pad = (value, width) => String(value).padEnd(width)

async function main() {
  const core = await read('core.json')
  const moves = await read('moves.json')
  const learnsets = await read('learnsets.json')
  const report = await read('report.json')

  const abilityName = id => core.abilities.find(entry => entry.id === id)?.name ?? '—'
  const moveName = id => moves.moves.find(entry => entry.id === id)?.name ?? `#${id}`

  process.stdout.write(`Battle Catalog ${core.catalogVersion} · ${core.provenance.ruleset}\n`)
  process.stdout.write(`${core.provenance.scope}\n`)
  for (const source of core.provenance.sources) {
    process.stdout.write(`  ${pad(source.id, 18)} ${source.license ?? '—'}  ${source.commit ?? ''}\n`)
  }
  process.stdout.write(`\n${JSON.stringify(report, null, 0)}\n`)

  process.stdout.write('\n── SPECIES ─────────────────────────────────────────────\n')
  for (const [name, why] of SPECIES) {
    const species = core.species.find(entry => entry.name === name)
    if (!species) { process.stdout.write(`${name}: MISSING\n`); continue }
    const forms = core.forms.filter(form => form.speciesId === species.id)
    const base = forms.find(form => form.isDefault) ?? forms[0]
    const learnset = learnsets.learnsets[String(base.id)] ?? { level: [], machine: [], egg: [], tutor: [] }
    process.stdout.write(`\n${species.name}  (#${species.id}) — ${why}\n`)
    process.stdout.write(`  types      ${base.types.join(' / ')}\n`)
    process.stdout.write(`  stats      HP ${base.baseStats[0]}  Atk ${base.baseStats[1]}  Def ${base.baseStats[2]}`
      + `  SpA ${base.baseStats[3]}  SpD ${base.baseStats[4]}  Spe ${base.baseStats[5]}\n`)
    process.stdout.write(`  catch rate ${species.catchRate}   growth ${species.growthRate}\n`)
    process.stdout.write(`  abilities  ${abilityName(base.abilities.slot1)}`
      + `${base.abilities.slot2 ? ` / ${abilityName(base.abilities.slot2)}` : ''}`
      + `${base.abilities.hidden ? `  (hidden: ${abilityName(base.abilities.hidden)})` : ''}\n`)
    const levels = learnset.level.slice(0, 6).map(([id, level]) => `${level}:${moveName(id)}`).join('  ')
    process.stdout.write(`  learnset   ${learnset.level.length} by level, ${learnset.machine.length} TM,`
      + ` ${learnset.egg.length} egg, ${learnset.tutor.length} tutor\n`)
    process.stdout.write(`             first: ${levels}\n`)
    if (forms.length > 1) {
      for (const form of forms.filter(entry => !entry.isDefault)) {
        process.stdout.write(`  form       ${pad(form.formName ?? form.name, 12)} ${pad(form.types.join('/'), 16)}`
          + ` ${form.baseStats.join(',')}${form.isMega ? '  (mega)' : ''}\n`)
      }
    }
  }

  process.stdout.write('\n── MOVES ───────────────────────────────────────────────\n')
  process.stdout.write(`${pad('name', 15)}${pad('shape', 26)}${pad('type', 9)}${pad('cat', 9)}`
    + `${pad('pow', 5)}${pad('acc', 5)}${pad('pp', 4)}${pad('pri', 4)}${pad('effect', 18)}status\n`)
  for (const [name, shape] of MOVES) {
    const move = moves.moves.find(entry => entry.name === name)
    if (!move) { process.stdout.write(`${name}: MISSING\n`); continue }
    process.stdout.write(`${pad(move.name, 15)}${pad(shape, 26)}${pad(move.type, 9)}${pad(move.category, 9)}`
      + `${pad(move.power ?? '—', 5)}${pad(move.accuracy ?? '—', 5)}${pad(move.pp, 4)}${pad(move.priority, 4)}`
      + `${pad(move.effectId, 18)}${move.supported ? 'runnable' : `pending: ${move.unsupportedReason}`}\n`)
  }

  process.stdout.write('\n── TYPE CHART SPOT CHECKS ──────────────────────────────\n')
  const chart = core.typeChart
  const pairs = [['fairy', 'dragon'], ['dragon', 'fairy'], ['fighting', 'fairy'], ['ghost', 'steel'],
    ['dark', 'steel'], ['electric', 'ground'], ['water', 'fire'], ['normal', 'ghost']]
  for (const [from, to] of pairs) {
    process.stdout.write(`  ${pad(from, 10)} → ${pad(to, 10)} ${chart[from]?.[to] ?? 1}×\n`)
  }
}

main().catch(error => { console.error(error); process.exit(1) })
