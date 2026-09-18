// Step 2 of the Battle Catalog pipeline (R32.1): emit PokeSwap's own catalog.
//
//   node scripts/battle-catalog/fetch.mjs
//   node scripts/battle-catalog/build.mjs
//
// Reads the cached source tables and writes `src/features/battle/catalog/
// generated/`: species and their Gen VI forms, moves with Gen VI values,
// abilities, ORAS learnsets, the type chart and natures — nothing else. No
// flavour text, no sprites, no descriptions.
//
// Rules this file keeps:
//   - **Deterministic.** Everything is sorted by id and serialised the same
//     way, so the same sources always produce byte-identical output.
//   - **Generation VI.** `moves.csv` holds present-day values; every change
//     recorded after ORAS is rolled back through `move_changelog.csv`.
//   - **Honest.** Anything the catalog cannot express is marked, never guessed.
//   - **Versioned.** `catalogVersion` is derived from the content, so client
//     and server can refuse to talk across a mismatch.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { groupBy, num, readTable } from './lib/csv.mjs'
import { describeEffect } from './effects.mjs'
import { parseGenSixDiff, showdownKey } from './genSix.mjs'
import { CACHE_DIR, loadSources, readManifest } from './fetch.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(here, '..', '..', 'src', 'features', 'battle', 'catalog', 'generated')

/** The species PokeSwap uses today (Gen I–IV). Widening this needs no schema change. */
const MAX_SPECIES_ID = 493
/** `version_groups.csv`: omega-ruby-alpha-sapphire. */
const ORAS_VERSION_GROUP = 16
/** Version groups that came after ORAS, newest last; used to roll values back. */
const AFTER_ORAS = [17, 18, 19, 20, 21, 22, 23, 24, 25]
const GEN_VI = 6

const table = async name => readTable(await readFile(join(CACHE_DIR, name), 'utf8'))

/** Stable JSON: sorted arrays, no surprises between runs. */
const stable = value => `${JSON.stringify(value, null, 1)}\n`

async function main() {
  const sources = await loadSources()
  const manifest = await readManifest()
  if (!manifest) throw new Error('No cached sources. Run scripts/battle-catalog/fetch.mjs first.')

  const [
    speciesRows, pokemonRows, typeRows, statRows, abilityMapRows, formRows, moveRows,
    changelogRows, flagMapRows, flagRows, metaRows, ailmentRows, categoryRows, targetRows,
    damageClassRows, abilityRows, natureRows, efficacyRows, typeNameRows, statNameRows, growthRows,
  ] = await Promise.all([
    table('pokemon_species.csv'), table('pokemon.csv'), table('pokemon_types.csv'), table('pokemon_stats.csv'),
    table('pokemon_abilities.csv'), table('pokemon_forms.csv'), table('moves.csv'), table('move_changelog.csv'),
    table('move_flag_map.csv'), table('move_flags.csv'), table('move_meta.csv'), table('move_meta_ailments.csv'),
    table('move_meta_categories.csv'), table('move_targets.csv'), table('move_damage_classes.csv'),
    table('abilities.csv'), table('natures.csv'), table('type_efficacy.csv'), table('types.csv'),
    table('stats.csv'), table('growth_rates.csv'),
  ])

  const issues = []
  // What the tabular source records at today's values, rolled back to Gen VI.
  const genSix = parseGenSixDiff(await readFile(join(CACHE_DIR, 'pokedex.ts'), 'utf8'))
  const corrections = { baseStats: [], abilities: [], types: [] }
  const name = (rows, id) => rows.find(row => Number(row.id) === Number(id))?.identifier ?? null

  // ── Types and the chart ───────────────────────────────────────────────────
  const types = typeNameRows
    .filter(row => Number(row.id) <= 18 && Number(row.generation_id) <= GEN_VI)
    .map(row => ({ id: Number(row.id), name: row.identifier }))
    .sort((a, b) => a.id - b.id)
  const typeName = new Map(types.map(entry => [entry.id, entry.name]))

  const typeChart = {}
  for (const type of types) typeChart[type.name] = {}
  for (const row of efficacyRows) {
    const from = typeName.get(Number(row.damage_type_id))
    const to = typeName.get(Number(row.target_type_id))
    if (!from || !to) continue
    const factor = Number(row.damage_factor) / 100
    // Only the departures from 1× are worth storing; the reader defaults to 1.
    if (factor !== 1) typeChart[from][to] = factor
  }

  // ── Natures ───────────────────────────────────────────────────────────────
  const statName = new Map(statNameRows.map(row => [Number(row.id), row.identifier]))
  const natures = natureRows
    .map(row => ({
      id: Number(row.id),
      name: row.identifier,
      increased: statName.get(Number(row.increased_stat_id)) ?? null,
      decreased: statName.get(Number(row.decreased_stat_id)) ?? null,
    }))
    .sort((a, b) => a.id - b.id)

  // ── Abilities ─────────────────────────────────────────────────────────────
  const abilities = abilityRows
    .filter(row => Number(row.generation_id) <= GEN_VI && row.is_main_series === '1')
    .map(row => ({ id: Number(row.id), name: row.identifier }))
    .sort((a, b) => a.id - b.id)
  const abilityIds = new Set(abilities.map(entry => entry.id))

  // ── Species and their Gen VI forms ────────────────────────────────────────
  const growthName = new Map(growthRows.map(row => [Number(row.id), row.identifier]))
  const formByPokemon = groupBy(formRows, row => Number(row.pokemon_id))
  const typesByPokemon = groupBy(typeRows, row => Number(row.pokemon_id))
  const statsByPokemon = groupBy(statRows, row => Number(row.pokemon_id))
  const abilitiesByPokemon = groupBy(abilityMapRows, row => Number(row.pokemon_id))

  const species = []
  const forms = []
  for (const row of speciesRows) {
    const speciesId = Number(row.id)
    if (speciesId > MAX_SPECIES_ID) continue
    species.push({
      id: speciesId,
      name: row.identifier,
      catchRate: Number(row.capture_rate),
      growthRate: growthName.get(Number(row.growth_rate_id)) ?? null,
      genderRate: Number(row.gender_rate),
      baseHappiness: Number(row.base_happiness),
    })
  }
  species.sort((a, b) => a.id - b.id)
  const speciesIds = new Set(species.map(entry => entry.id))

  for (const row of pokemonRows) {
    const speciesId = Number(row.species_id)
    if (!speciesIds.has(speciesId)) continue
    const pokemonId = Number(row.id)
    const form = (formByPokemon.get(pokemonId) ?? [])[0]
    // A form that only exists from Gen VII onwards is out of this ruleset.
    const introduced = form ? Number(form.introduced_in_version_group_id) : 1
    if (introduced > ORAS_VERSION_GROUP) continue

    const slots = (typesByPokemon.get(pokemonId) ?? [])
      .sort((a, b) => Number(a.slot) - Number(b.slot))
      .map(entry => typeName.get(Number(entry.type_id)))
      .filter(Boolean)
    const stats = (statsByPokemon.get(pokemonId) ?? [])
      .sort((a, b) => Number(a.stat_id) - Number(b.stat_id))
    const baseStats = [1, 2, 3, 4, 5, 6].map(statId =>
      Number(stats.find(entry => Number(entry.stat_id) === statId)?.base_stat ?? 0))

    const ownAbilities = (abilitiesByPokemon.get(pokemonId) ?? [])
      .filter(entry => abilityIds.has(Number(entry.ability_id)))
      .sort((a, b) => Number(a.slot) - Number(b.slot))
    const slot1 = ownAbilities.find(entry => entry.slot === '1')
    const slot2 = ownAbilities.find(entry => entry.slot === '2')
    const hidden = ownAbilities.find(entry => entry.is_hidden === '1')

    if (slots.length === 0) issues.push(`form ${pokemonId} (${row.identifier}) has no types`)
    if (baseStats.some(value => value <= 0)) issues.push(`form ${pokemonId} (${row.identifier}) has an invalid base stat`)


    // Apply the Gen VI diff before the row is written down.
    const patch = genSix.get(showdownKey(row.identifier))
    let genSixTypes = slots
    let genSixStats = baseStats
    const genSixAbilities = {
      slot1: slot1 ? Number(slot1.ability_id) : null,
      slot2: slot2 ? Number(slot2.ability_id) : null,
      hidden: hidden ? Number(hidden.ability_id) : null,
    }
    if (patch?.baseStats && patch.baseStats.join() !== baseStats.join()) {
      corrections.baseStats.push(row.identifier)
      genSixStats = patch.baseStats
    }
    if (patch?.types && patch.types.join() !== slots.join()) {
      corrections.types.push(row.identifier)
      genSixTypes = patch.types
    }
    if (patch?.abilities) {
      const byName = new Map(abilities.map(entry => [entry.name, entry.id]))
      const resolved = {
        slot1: patch.abilities.slot1 ? byName.get(patch.abilities.slot1) ?? null : null,
        slot2: patch.abilities.slot2 ? byName.get(patch.abilities.slot2) ?? null : null,
        hidden: patch.abilities.hidden ? byName.get(patch.abilities.hidden) ?? null : null,
      }
      for (const [slot, id] of Object.entries(patch.abilities)) {
        if (id && resolved[slot] === null) issues.push(`${row.identifier}: unknown Gen VI ability "${id}"`)
      }
      if (JSON.stringify(resolved) !== JSON.stringify(genSixAbilities)) {
        corrections.abilities.push(row.identifier)
        Object.assign(genSixAbilities, resolved)
      }
    }

    forms.push({
      id: pokemonId,
      speciesId,
      name: row.identifier,
      formName: form?.form_identifier || null,
      isDefault: row.is_default === '1',
      isMega: form?.is_mega === '1',
      isBattleOnly: form?.is_battle_only === '1',
      types: genSixTypes,
      baseStats: genSixStats,
      abilities: genSixAbilities,
    })
  }
  forms.sort((a, b) => a.id - b.id)
  const formIds = new Set(forms.map(entry => entry.id))

  for (const entry of species) {
    if (!forms.some(form => form.speciesId === entry.id && form.isDefault)) {
      issues.push(`species ${entry.id} (${entry.name}) has no default form`)
    }
  }

  // ── Moves, rolled back to Generation VI ───────────────────────────────────
  const flagName = new Map(flagRows.map(row => [Number(row.id), row.identifier]))
  const flagsByMove = groupBy(flagMapRows, row => Number(row.move_id))
  const metaByMove = new Map(metaRows.map(row => [Number(row.move_id), row]))
  const changesByMove = groupBy(changelogRows, row => Number(row.move_id))
  const ailmentName = new Map(ailmentRows.map(row => [Number(row.id), row.identifier]))
  const categoryName = new Map(categoryRows.map(row => [Number(row.id), row.identifier]))

  /**
   * The value a column had in ORAS: the earliest change recorded *after* it
   * carries the value as it was before that change.
   */
  const asOfOras = (moveId, column, current) => {
    const rows = (changesByMove.get(moveId) ?? [])
      .filter(row => AFTER_ORAS.includes(Number(row.changed_in_version_group_id)))
      .sort((a, b) => Number(a.changed_in_version_group_id) - Number(b.changed_in_version_group_id))
    for (const row of rows) if (row[column] !== '') return num(row[column])
    return current
  }

  const moves = []
  for (const row of moveRows) {
    const moveId = Number(row.id)
    if (Number(row.generation_id) > GEN_VI) continue
    if (moveId >= 10000) continue // shadow moves: not main series

    const flags = (flagsByMove.get(moveId) ?? [])
      .map(entry => flagName.get(Number(entry.move_flag_id)))
      .filter(Boolean)
      .sort()
    const meta = metaByMove.get(moveId)
    const category = categoryName.get(Number(meta?.meta_category_id)) ?? 'unique'
    const ailment = ailmentName.get(Number(meta?.meta_ailment_id)) ?? 'none'
    const damageClass = name(damageClassRows, row.damage_class_id)
    const typeId = asOfOras(moveId, 'type_id', Number(row.type_id))

    const effect = describeEffect({
      category,
      ailment,
      minHits: num(meta?.min_hits),
      maxHits: num(meta?.max_hits),
      flinchChance: Number(meta?.flinch_chance ?? 0),
      drain: num(meta?.drain),
      sourceEffectId: Number(row.effect_id),
      flags,
      identifier: row.identifier,
      damageClass,
      power: asOfOras(moveId, 'power', num(row.power)),
    })

    const move = {
      id: moveId,
      name: row.identifier,
      type: typeName.get(typeId) ?? null,
      category: damageClass,
      power: asOfOras(moveId, 'power', num(row.power)),
      accuracy: asOfOras(moveId, 'accuracy', num(row.accuracy)),
      pp: asOfOras(moveId, 'pp', num(row.pp)),
      priority: asOfOras(moveId, 'priority', Number(row.priority)),
      target: name(targetRows, asOfOras(moveId, 'target_id', Number(row.target_id))),
      flags,
      effectId: effect.effectId,
      supported: effect.supported,
      meta: {
        ailment: ailment === 'none' ? null : ailment,
        ailmentChance: Number(meta?.ailment_chance ?? 0) || null,
        statChance: Number(meta?.stat_chance ?? 0) || null,
        flinchChance: Number(meta?.flinch_chance ?? 0) || null,
        critRate: Number(meta?.crit_rate ?? 0) || null,
        drain: Number(meta?.drain ?? 0) || null,
        healing: Number(meta?.healing ?? 0) || null,
        minHits: num(meta?.min_hits),
        maxHits: num(meta?.max_hits),
      },
      /** Where this row came from, so a later phase can always check it. */
      source: { effectId: Number(row.effect_id), category },
    }
    if (!effect.supported) move.unsupportedReason = effect.unsupportedReason
    if (move.type === null) issues.push(`move ${moveId} (${move.name}) has no type`)
    if (!['physical', 'special', 'status'].includes(move.category)) {
      issues.push(`move ${moveId} (${move.name}) has an invalid category`)
    }
    moves.push(move)
  }
  moves.sort((a, b) => a.id - b.id)
  const moveIds = new Set(moves.map(entry => entry.id))

  // ── ORAS learnsets ────────────────────────────────────────────────────────
  const methodName = { 1: 'level', 2: 'egg', 3: 'tutor', 4: 'machine' }
  const learnsets = {}
  const learnRows = await table('pokemon_moves.csv')
  for (const row of learnRows) {
    if (Number(row.version_group_id) !== ORAS_VERSION_GROUP) continue
    const pokemonId = Number(row.pokemon_id)
    if (!formIds.has(pokemonId)) continue
    const method = methodName[Number(row.pokemon_move_method_id)]
    if (!method) continue
    const moveId = Number(row.move_id)
    if (!moveIds.has(moveId)) { issues.push(`learnset of ${pokemonId} points at unknown move ${moveId}`); continue }
    const entry = learnsets[pokemonId] ?? (learnsets[pokemonId] = { level: [], machine: [], egg: [], tutor: [] })
    if (method === 'level') entry.level.push([moveId, Number(row.level)])
    else entry[method].push(moveId)
  }
  for (const entry of Object.values(learnsets)) {
    entry.level.sort((a, b) => a[1] - b[1] || a[0] - b[0])
    for (const key of ['machine', 'egg', 'tutor']) entry[key] = [...new Set(entry[key])].sort((a, b) => a - b)
  }
  const withoutLearnset = forms.filter(form => form.isDefault && !learnsets[form.id])

  // ── Version, from the content itself ──────────────────────────────────────
  const payload = { types, typeChart, natures, abilities, species, forms, moves, learnsets }
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12)
  const catalogVersion = `1.oras.${hash}`

  const provenance = {
    ruleset: sources.ruleset,
    scope: sources.scope,
    sources: sources.sources.map(({ id, role, repo, commit, license }) => ({ id, role, repo, commit, license })),
    trademarks: sources.trademarks,
    generatedFrom: manifest.files,
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'version.ts'),
    '// GENERATED by scripts/battle-catalog/build.mjs — do not edit.\n'
    + '//\n'
    + '// Client and server both import this: an action carrying a different\n'
    + '// version is refused rather than resolved against a different catalog.\n'
    + `export const CATALOG_VERSION = '${catalogVersion}'\n`)
  await writeFile(join(OUT_DIR, 'core.json'), stable({
    catalogVersion, provenance, types, typeChart, natures, abilities, species, forms,
  }))
  await writeFile(join(OUT_DIR, 'moves.json'), stable({ catalogVersion, moves }))
  await writeFile(join(OUT_DIR, 'learnsets.json'), stable({ catalogVersion, learnsets }))

  const report = {
    catalogVersion,
    species: species.length,
    forms: forms.length,
    megaForms: forms.filter(form => form.isMega).length,
    moves: moves.length,
    supportedMoves: moves.filter(move => move.supported).length,
    unsupportedMoves: moves.filter(move => !move.supported).length,
    abilities: abilities.length,
    learnsets: Object.keys(learnsets).length,
    formsWithoutLearnset: withoutLearnset.length,
    natures: natures.length,
    types: types.length,
    genSixCorrections: {
      baseStats: corrections.baseStats.length,
      abilities: corrections.abilities.length,
      types: corrections.types.length,
      examples: {
        baseStats: corrections.baseStats.slice(0, 6),
        abilities: corrections.abilities.slice(0, 6),
      },
    },
    issues,
  }
  await writeFile(join(OUT_DIR, 'report.json'), stable(report))

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (issues.length) {
    process.stdout.write(`\n${issues.length} issue(s) — see report.json\n`)
    process.exitCode = 1
  }
}

main().catch(error => { console.error(error); process.exit(1) })
