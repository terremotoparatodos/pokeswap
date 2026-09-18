// Human sample of the Pokémon model (R32.2): `npm run pokemon:sample`.
//
// Prints real individuals built by the factory from the real Battle Catalog, so
// the model can be read and judged without a battle, a UI or a database. It
// writes nothing and touches no network: it is a lab, not a tool.
//
// The seed is fixed, so two runs print the same Pokémon; pass one to change it:
//   npm run pokemon:sample -- --seed 1234

import { loadBattleCatalog, loadLearnsets } from '../src/features/battle/catalog'
import { createSeededRandom } from '../src/features/professions/domain/rng'
import { createPokemonCatalogView } from '../src/features/pokemon/model/catalogView'
import { createPokemonInstance, createExpeditionCapture } from '../src/features/pokemon/model/factory'
import { experienceToNextLevel, levelForExperience } from '../src/features/pokemon/model/experience'
import { validateInstance } from '../src/features/pokemon/model/instance'
import type { PokemonInstance } from '../src/features/pokemon/model/instance'
import { deriveStats, statsFromTuple, totalEvs } from '../src/features/pokemon/model/stats'
import { projectLegacyPokemon } from '../src/features/pokemon/model/legacy'
import { isFainted } from '../src/features/pokemon/model/condition'
import { DEFAULT_MIGRATION, migrateLegacySlot } from '../src/features/pokemon/model/migration'

const SEED = Number(readFlag('--seed') ?? 20260318)

/** The five the gate asked for: a starter, a heavy hitter, a wall, a sweeper. */
const SAMPLE = [
  { name: 'Pikachu', speciesId: 25, level: 5 },
  { name: 'Pikachu', speciesId: 25, level: 50 },
  { name: 'Charizard', speciesId: 6, level: 36 },
  { name: 'Gengar', speciesId: 94, level: 50 },
  { name: 'Shuckle', speciesId: 213, level: 50 },
  { name: 'Ninjask', speciesId: 291, level: 50 },
]

function readFlag(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const pad = (value: string | number, width: number): string => String(value).padStart(width)

async function main(): Promise<void> {
  const [index, learnsets] = await Promise.all([loadBattleCatalog(), loadLearnsets()])
  const catalog = createPokemonCatalogView(index, learnsets)
  const random = createSeededRandom(SEED)
  const at = '2026-03-18T00:00:00.000Z'
  const acquisition = { source: 'adoption' as const, at, catalogVersion: index.catalogVersion }

  console.log(`PokéSwap — Pokémon model sample (R32.2)`)
  console.log(`catalog ${index.catalogVersion} · seed ${SEED}\n`)

  let n = 0
  for (const entry of SAMPLE) {
    const instance = createPokemonInstance(
      { speciesId: entry.speciesId, level: entry.level, acquisition, ownerId: 'sample-trainer' },
      catalog,
      random,
      `sample-${++n}`,
    )
    show(entry.name, instance)
  }

  // A dungeon capture, in the state I-1 says it lives in until it is extracted.
  const capture = createExpeditionCapture(
    {
      speciesId: 94,
      level: 22,
      acquisition: { source: 'dungeon_capture', at, catalogVersion: index.catalogVersion, ref: 'expedition-7' },
    },
    catalog,
    random,
  )
  show('Gengar (dungeon capture, pending)', { ...capture, instanceId: 'sample-capture' })

  // The legacy migration contract, applied in memory to one invented slot:
  // one slot is one Pokémon, whatever the number of pokemon_xp rows.
  const legacySlot = { pokemon_id: 25, owner_id: 'legacy-trainer', first_owner_id: 'the-very-first' }
  const legacyProgressions = [
    { user_id: 'legacy-trainer', pokemon_id: 25, xp: 41000, level: 34, moves: { 1: 'Impactrueno', 2: 'quick-attack' } },
    { user_id: 'former-owner', pokemon_id: 25, xp: 900000, level: 99, moves: { 1: 'thunderbolt' } },
  ]
  const outcome = migrateLegacySlot(
    { slot: legacySlot, progressions: legacyProgressions },
    catalog,
    { at, catalogVersion: index.catalogVersion },
  )
  if (outcome.kind === 'migrated') {
    show('Pikachu (migración legacy determinista)', { ...outcome.draft, instanceId: 'sample-legacy' })
    console.log(`  migration v${DEFAULT_MIGRATION.version} salt "${DEFAULT_MIGRATION.salt}"`)
    console.log(`  preservado: ${outcome.report.preserved.join(', ')}`)
    console.log(`  derivado por hash: ${outcome.report.derived.join(', ')}`)
    console.log(`  progresiones de ex-dueños ignoradas: ${outcome.report.ignoredHistoricalProgressions}`)
    if (outcome.report.ignoredStoredLevel !== null) {
      console.log(`  level guardado ignorado (gana el xp): ${outcome.report.ignoredStoredLevel}`)
    }
    if (outcome.report.needsMoveBackfill) console.log('  necesita backfill de movimientos (no se aplica)')
    console.log('')
  }

  // And a slot nobody owns: it is part of the pool, not somebody's Pokémon.
  const unowned = migrateLegacySlot({ slot: { pokemon_id: 6, owner_id: null } }, catalog, {
    at,
    catalogVersion: index.catalogVersion,
  })
  console.log(`── slot sin dueño ${'─'.repeat(55)}`)
  console.log(`  charizard (#6): ${unowned.kind}${unowned.kind === 'skipped' ? ` (${unowned.reason})` : ''} — no genera PokemonInstance`)
  console.log('')

  // And what the same model can say about a Pokémon that exists in production.
  const legacy = projectLegacyPokemon(
    { user_id: 'legacy-trainer', pokemon_id: 25, xp: 41000, level: 34, moves: { 1: 'thunder-shock', 2: 'quick-attack' } },
    catalog,
    { slot: legacySlot },
  )
  console.log('── legacy row (pokemon_xp) ' + '─'.repeat(46))
  console.log(`  species ${legacy.known.speciesId} · ${legacy.known.experience} xp · level ${legacy.known.level}`)
  console.log(`  owner ${legacy.known.ownership.ownerId} · moves ${legacy.known.moves.map(slot => index.move(slot.moveId)?.name).join(', ') || '(none)'}`)
  console.log(`  cannot be answered by production: ${legacy.gaps.map(gap => gap.field).join(', ')}`)
  if (legacy.problems.length > 0) console.log(`  problems: ${legacy.problems.join('; ')}`)
  console.log('')

  function show(title: string, instance: PokemonInstance): void {
    const form = catalog.formById(instance.formId)!
    const species = catalog.speciesOf(instance.speciesId)!
    const nature = index.nature(instance.natureId)!
    const level = levelForExperience(instance.experience)
    const stats = deriveStats(
      { base: statsFromTuple(form.baseStats), level, ivs: instance.ivs, evs: instance.evs, nature },
      species.id === 292,
    )
    const issues = validateInstance(instance, catalog)

    console.log('── ' + title + ' ' + '─'.repeat(Math.max(0, 70 - title.length)))
    console.log(`  ${form.name} (#${species.id}, form ${form.id}) · ${form.types.join('/')} · ${instance.gender}${instance.shiny ? ' · SHINY' : ''}`)
    console.log(`  level ${level} · ${instance.experience} xp (${experienceToNextLevel(instance.experience)} to next) · ${instance.state}`)
    console.log(`  nature ${nature.name}${nature.increased ? ` (+${nature.increased} / -${nature.decreased})` : ' (neutral)'} · ability ${index.ability(instance.abilityId)?.name}`)
    console.log('           HP  Atk  Def  SpA  SpD  Spe')
    console.log(`  base   ${form.baseStats.map(value => pad(value, 4)).join(' ')}`)
    console.log(`  IVs    ${[instance.ivs.hp, instance.ivs.atk, instance.ivs.def, instance.ivs.spa, instance.ivs.spd, instance.ivs.spe].map(value => pad(value, 4)).join(' ')}`)
    console.log(`  EVs    ${[instance.evs.hp, instance.evs.atk, instance.evs.def, instance.evs.spa, instance.evs.spd, instance.evs.spe].map(value => pad(value, 4)).join(' ')}  (${totalEvs(instance.evs)}/510)`)
    console.log(`  stats  ${[stats.hp, stats.atk, stats.def, stats.spa, stats.spd, stats.spe].map(value => pad(value, 4)).join(' ')}`)
    for (const slot of instance.moves) {
      const move = index.move(slot.moveId)!
      const max = move.pp + Math.floor((move.pp * slot.ppUps) / 5)
      const left = instance.condition.pp[slot.moveId] ?? max
      console.log(`  · ${move.name.padEnd(16)} ${move.type.padEnd(9)} ${move.category.padEnd(9)} ${pad(move.power ?? '—', 3)} pow  ${left}/${max} PP${move.supported ? '' : `  (R32.3: ${move.unsupportedReason})`}`)
    }
    const { currentHp, majorStatus } = instance.condition
    console.log(`  condición: ${currentHp === null ? 'sin daño' : `${currentHp} HP`} · ${majorStatus}${isFainted(instance.condition) ? ' · DEBILITADO' : ''}`)
    console.log(`  owner ${instance.ownership.ownerId ?? '(nobody yet)'} · from ${instance.acquisition.source}${instance.acquisition.ref ? ` ${instance.acquisition.ref}` : ''}`)
    console.log(`  validation: ${issues.length === 0 ? 'OK' : issues.join('; ')}`)
    console.log('')
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
