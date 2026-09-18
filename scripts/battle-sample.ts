// Human sample of the Shared Battle Rules (R32.3): `npm run battle:sample`.
//
// Runs real battles from the real catalog and prints what happened, so the
// engine can be read and judged without a UI, a server or a database. It
// writes nothing and touches no network: a lab, not a tool.
//
// The fixtures are the ones the suite asserts on (`sampleBattles.ts`), so what
// a human reads here and what CI checks are the same battle.
//
//   npm run battle:sample                 both headline fights, plus the rule fixtures
//   npm run battle:sample -- --coverage   only the move coverage report

import { loadBattleCatalog } from '../src/features/battle/catalog'
import {
  BATTLE_RULES_VERSION, actionBarFill, baseCooldownMs, classifyMove, cooldownMs,
  finishBattle, isCombatantFainted, reduceBattle, reportMoveCoverage,
} from '../src/features/battle/rules'
import type { BattleCommand, BattleEvent, BattleState, BattleTransition } from '../src/features/battle/rules'
import {
  CHARIZARD_VS_AZUMARILL, PIKACHU_VS_GENGAR, buildSampleBattle,
} from '../src/features/battle/rules/sampleBattles'
import type { SampleBattle, SampleBattleInput } from '../src/features/battle/rules/sampleBattles'

const pad = (value: string | number, width: number): string => String(value).padStart(width)
const has = (flag: string): boolean => process.argv.includes(flag)

function describeEvent(event: BattleEvent, names: Record<string, string>): string | null {
  const who = (id: string | null): string => (id ? (names[id] ?? id) : '—')
  switch (event.type) {
    case 'ACTION_STARTED': return `${who(event.combatantId)} actúa (${event.action})`
    case 'MOVE_USED': return `  usa movimiento ${event.moveId} contra ${who(event.targetId)}`
    case 'MOVE_MISSED': return `  falla el movimiento ${event.moveId}`
    case 'MOVE_REFUSED': return `  no puede usar ${event.moveId}: ${event.refusal.kind}${'reason' in event.refusal ? ` (${event.refusal.reason})` : ''}`
    case 'DAMAGE': return `  ${who(event.combatantId)} recibe ${event.amount} (${event.cause}${event.critical ? ', crítico' : ''}, ×${event.effectiveness}) → ${event.remainingHp} HP`
    case 'HEAL': return `  ${who(event.combatantId)} cura ${event.amount} (${event.cause}) → ${event.remainingHp} HP`
    case 'PP_CHANGED': return `  PP del movimiento ${event.moveId}: ${event.remaining}/${event.max}`
    case 'STATUS_APPLIED': return `  ${who(event.combatantId)} queda con ${event.status}`
    case 'STATUS_FAILED': return `  ${event.status} no prendió en ${who(event.combatantId)} (${event.reason})`
    case 'STATUS_TICK': return `  ${who(event.combatantId)} sufre ${event.status}: ${event.damage} → ${event.remainingHp} HP`
    case 'STATUS_ENDED': return `  ${who(event.combatantId)} se recupera de ${event.status}`
    case 'CONFUSION_APPLIED': return `  ${who(event.combatantId)} queda confundido (${event.durationMs} ms)`
    case 'CONFUSION_SELF_HIT': return `  ${who(event.combatantId)} se golpea a sí mismo (${event.damage})`
    case 'CONFUSION_ENDED': return `  ${who(event.combatantId)} deja de estar confundido`
    case 'PROTECT_GAINED': return `  ${who(event.combatantId)} levanta escudo ×${event.charges}`
    case 'PROTECT_BLOCKED': return `  escudo de ${who(event.combatantId)} bloquea (${event.chargesLeft} restantes)`
    case 'PROTECT_EXPIRED': return `  el escudo de ${who(event.combatantId)} se agotó: próximo cooldown ×2`
    case 'SWITCHED': return `  cambio: sale ${who(event.outgoingId)}, entra ${who(event.incomingId)}`
    case 'ITEM_USED': return `  objeto ${event.item.kind} sobre ${who(event.targetId)} (${event.worked ? 'sirvió' : 'no hizo nada'})`
    case 'CAPTURE_ATTEMPT': return `  lanza ${event.ball.id} (${Math.round(event.chance * 100)} %, ${event.shakes} sacudidas)`
    case 'CAPTURE_SUCCESS': return `  ¡capturado!`
    case 'CAPTURE_FAILED': return `  se escapó`
    case 'FAINTED': return `  ${who(event.combatantId)} se debilitó`
    case 'BATTLE_ENDED': return `FIN — gana ${who(event.winningSideId)} (${event.reason})`
    case 'COMMAND_REJECTED': return `  comando rechazado: ${event.reason}`
    default: return null
  }
}

function run(
  battle: SampleBattle, state: BattleState, commands: readonly BattleCommand[],
): { state: BattleState; events: BattleEvent[] } {
  let current = state
  const events: BattleEvent[] = []
  for (const command of commands) {
    const step: BattleTransition = reduceBattle(current, command, battle.context)
    current = step.state
    events.push(...step.events)
  }
  return { state: current, events }
}

async function playFixture(input: SampleBattleInput, title: string): Promise<void> {
  const battle = await buildSampleBattle(input)
  const names: Record<string, string> = {}
  for (const combatant of Object.values(battle.state.combatants)) {
    names[combatant.combatantId] = `#${combatant.instance.speciesId} (${combatant.combatantId})`
  }
  names.ally = 'aliado'
  names.enemy = 'salvaje'

  console.log(`\n═══ ${title} ═══`)
  console.log(`seed ${battle.state.rng.seed} · reglas ${battle.state.battleRulesVersion} · catálogo ${battle.state.catalogVersion}\n`)

  for (const combatant of Object.values(battle.state.combatants)) {
    const stats = combatant.stats
    console.log(`${names[combatant.combatantId]} · N${combatant.level}`)
    console.log(`  stats   HP ${pad(stats.hp, 3)}  At ${pad(stats.atk, 3)}  Df ${pad(stats.def, 3)}  SpA ${pad(stats.spa, 3)}  SpD ${pad(stats.spd, 3)}  Ve ${pad(stats.spe, 3)}`)
    console.log(`  cooldown ${(cooldownMs(combatant, battle.state.config) / 1000).toFixed(2)} s (base a Velocidad ${stats.spe}: ${(baseCooldownMs(stats.spe, battle.state.config) / 1000).toFixed(2)} s)`)
    for (const slot of combatant.instance.moves) {
      const move = battle.catalog.move(slot.moveId)
      if (!move) continue
      const verdict = classifyMove(move)
      console.log(`  · ${move.name.padEnd(14)} ${move.type.padEnd(9)} ${move.category.padEnd(8)} ${pad(move.power ?? '—', 3)} pow  ${pad(move.accuracy ?? '—', 3)} acc  ${pad(move.pp, 2)} PP  ${verdict.kind === 'executable' ? verdict.effect : `DIFERIDO: ${verdict.reason}`}`)
    }
  }

  // The player keeps one move selected; the wild side never selects anything
  // and falls back on its first usable move, which is the approved fallback.
  const commands: BattleCommand[] = [
    { type: 'USE_MOVE', combatantId: 'ally-0', moveId: battle.moveId(input.ally.moves[0]) },
  ]
  for (let i = 0; i < 40; i++) commands.push({ type: 'ADVANCE_TIME', deltaMs: 500 })

  const result = run(battle, battle.state, commands)
  console.log('')
  for (const event of result.events) {
    const line = describeEvent(event, names)
    if (line) console.log(`${pad((event.atMs / 1000).toFixed(1), 6)}s  ${line}`)
  }

  console.log(`\nresultado: ${JSON.stringify(result.state.outcome)} · ${result.events.length} eventos · ${result.state.rng.cursor} tiradas`)
  const after = finishBattle(result.state)
  for (const [id, instance] of Object.entries(after)) {
    const combatant = result.state.combatants[id]
    console.log(`  ${names[id]} sale con ${instance.condition.currentHp ?? combatant.stats.hp}/${combatant.stats.hp} HP · ${instance.condition.majorStatus}${isCombatantFainted(combatant) ? ' · DEBILITADO' : ''} · barra ${(actionBarFill(combatant, result.state.config) * 100).toFixed(0)} %`)
  }
}

async function playRuleFixtures(): Promise<void> {
  console.log(`\n═══ Fixtures de reglas ═══`)

  // Protect: the shield eats two offensive actions and then costs its user time.
  const protect = await buildSampleBattle({
    battleId: 'fixture-protect', seed: 7,
    ally: { speciesId: 6, level: 50, moves: ['protect', 'flamethrower'] },
    enemy: { speciesId: 184, level: 50, wild: true, moves: ['body-slam'] },
  })
  const protectRun = run(protect, protect.state, [
    { type: 'USE_MOVE', combatantId: 'ally-0', moveId: protect.moveId('protect') },
    ...Array.from({ length: 30 }, () => ({ type: 'ADVANCE_TIME', deltaMs: 500 }) as BattleCommand),
  ])
  console.log('Protect:', protectRun.events.filter(e => e.type.startsWith('PROTECT')).map(e => e.type).join(' → ') || '(sin eventos)')

  // Struggle: a Pokémon with no PP left still does something, and it hurts.
  const struggle = await buildSampleBattle({
    battleId: 'fixture-struggle', seed: 3,
    ally: { speciesId: 25, level: 50, moves: ['hydro-pump'] },
    enemy: { speciesId: 94, level: 50, wild: true, moves: ['splash'] },
  })
  const drained = {
    ...struggle.state,
    combatants: {
      ...struggle.state.combatants,
      'ally-0': {
        ...struggle.state.combatants['ally-0'],
        condition: { ...struggle.state.combatants['ally-0'].condition, pp: { [struggle.moveId('hydro-pump')]: 0 } },
      },
    },
  }
  const struggleRun = run(struggle, drained, [{ type: 'ADVANCE_TIME', deltaMs: 6000 }])
  const struggled = struggleRun.events.some(e => e.type === 'ACTION_STARTED' && e.action === 'struggle')
  console.log(`Struggle: ${struggled ? 'sin PP recurre a Combate y se hiere' : 'NO se activó'}`)

  // Determinism: the same battle, run twice, told the same way.
  const first = await buildSampleBattle(PIKACHU_VS_GENGAR)
  const second = await buildSampleBattle(PIKACHU_VS_GENGAR)
  const script: BattleCommand[] = [
    { type: 'USE_MOVE', combatantId: 'ally-0', moveId: first.moveId('thunderbolt') },
    ...Array.from({ length: 60 }, () => ({ type: 'ADVANCE_TIME', deltaMs: 250 }) as BattleCommand),
  ]
  const runA = run(first, first.state, script)
  const runB = run(second, second.state, script)
  const same = JSON.stringify(runA.state) === JSON.stringify(runB.state)
    && JSON.stringify(runA.events) === JSON.stringify(runB.events)
  console.log(`Replay determinista: ${same ? 'idéntico estado y eventos' : '¡DIFERENTE!'}`)

  // The slicing of the clock must not change the battle.
  const coarse = await buildSampleBattle(PIKACHU_VS_GENGAR)
  const coarseRun = run(coarse, coarse.state, [
    { type: 'USE_MOVE', combatantId: 'ally-0', moveId: coarse.moveId('thunderbolt') },
    { type: 'ADVANCE_TIME', deltaMs: 15000 },
  ])
  const sliceSame = JSON.stringify(coarseRun.state.combatants) === JSON.stringify(runA.state.combatants)
  console.log(`Granularidad del reloj: ${sliceSame ? '15 s de una vez = 60 × 250 ms' : '¡DIFERENTE!'}`)
}

async function main(): Promise<void> {
  const index = await loadBattleCatalog()
  console.log('PokéSwap — Shared Battle Rules (R32.3)')
  console.log(`reglas ${BATTLE_RULES_VERSION} · catálogo ${index.catalogVersion}`)

  const coverage = reportMoveCoverage(index.catalog.moves)
  console.log(`\nCobertura de movimientos: ${coverage.executable}/${coverage.total} ejecutables, ${coverage.deferred} diferidos`)
  for (const row of coverage.byReason) console.log(`  ${pad(row.moves, 4)}  ${row.reason}`)
  if (has('--coverage')) return

  await playFixture(PIKACHU_VS_GENGAR, 'Pikachu vs Gengar')
  await playFixture(CHARIZARD_VS_AZUMARILL, 'Charizard vs Azumarill')
  await playRuleFixtures()
  console.log('\nListo. Nada se escribió y no se tocó la red.')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
