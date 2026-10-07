// @vitest-environment node
// ECO-GAMEPLAY-2 test battle bundle: exactly what encounterBattleRuntime.ts builds to, reproducible,
// loadable by plain Node, exposing only the encounter-battle factory (never the bare authority), and
// behaving as the contract says: a battle for every ECO species, outcomes decided by the rules,
// sandbox-only intents, the authority's own validation for everything else.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { spawnSync } from 'node:child_process'
// @ts-expect-error — idem
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
// @ts-expect-error — idem
import { tmpdir } from 'node:os'
// @ts-expect-error — idem
import { join } from 'node:path'
// @ts-expect-error — idem
import { execPath } from 'node:process'
// @ts-expect-error — idem
import { pathToFileURL } from 'node:url'
// @ts-expect-error — plain .mjs build script, no type declarations
import { OUTPUT, bundleBattle, bundleStatus } from '../../../../scripts/integration/bundle-battle.mjs'
// @ts-expect-error — generated plain JS, no type declarations (the TS sources are the typed API)
import * as bundle from '../../../../services/realtime/src/world/ecosystem/encounterBattle.generated.js'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import * as source from './encounterBattleRuntime'
import type { EncounterBattle } from './encounterBattleRuntime'

type Api = typeof source
const ECO_SPECIES = [...new Set(ECO_1_ENCOUNTER_CATALOG.entries.map(e => e.speciesId))]
const CONTROLLER = 'benchmark-eco-a'

async function battles(api: Api = source) {
  const prepared = await api.prepareEncounterBattles()
  if (!prepared.ok) throw new Error(prepared.reason)
  return prepared.battles
}
const start = async (speciesId = 19, seed = 7, api: Api = source) => {
  const r = (await battles(api)).start({ battleId: `eco-battle-${speciesId}-${seed}`, controllerId: CONTROLLER, speciesId, seed })
  if (!r.ok) throw new Error(r.reason)
  return r.battle
}
const action = (battle: EncounterBattle, sequence: number, intent: Record<string, unknown>, controller = CONTROLLER) => {
  const s = battle.snapshot()
  return { actionId: `${controller}:${sequence}`, battleId: battle.battleId, catalogVersion: s.catalogVersion, battleRulesVersion: s.battleRulesVersion, intent }
}
const firstMove = (battle: EncounterBattle) => battle.snapshot().combatants['player-0'].instance.moves[0].moveId
const runOut = (battle: EncounterBattle) => { for (let t = 0; t < 120_000 && battle.outcome() === 'ongoing'; t += 250) battle.advance(250); return battle.outcome() }

describe('the committed battle bundle', () => {
  it('is up to date with its sources and reproducible, with no imports or absolute paths', async () => {
    const fresh = await bundleBattle()
    expect(await bundleStatus(fresh, OUTPUT)).toBe('fresh')
    expect(fresh).toBe(await bundleBattle())
    const text = readFileSync(OUTPUT, 'utf8')
    // esbuild's own `__require` helper (CommonJS JSON wrappers) is not an external require.
    expect(text).not.toMatch(/^import |(^|[^_A-Za-z0-9$])require\(/m)
    expect(text).not.toMatch(/(?:^|["'\s(])[A-Za-z]:[\\/]|\/Users\/|\/home\//m)
  }, 60_000)

  it('exports only the encounter-battle factory and its fixture: never the bare authority', () => {
    expect(Object.keys(bundle).sort()).toEqual(Object.keys(source).sort())
    expect(Object.keys(bundle).sort()).toEqual(['ECO_BATTLE_API', 'ECO_SANDBOX_FIXTURE', 'REJECTION', 'SANDBOX_REJECTION', 'prepareEncounterBattles'])
    for (const bare of ['createBattleAuthority', 'reduceBattle', 'createBattleState', 'createPokemonInstance']) expect(bundle).not.toHaveProperty(bare)
    expect(bundle.ECO_SANDBOX_FIXTURE.label).toBe('fixture de prueba')
  })

  it('loads in a bare Node process and runs a battle to its end', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eco-battle-'))
    try {
      const script = `const m = await import(${JSON.stringify(pathToFileURL(OUTPUT).href)});`
        + "const p = await m.prepareEncounterBattles(); const r = p.battles.start({ battleId: 'b', controllerId: 'c', speciesId: 19, seed: 7 });"
        + "let s; for (let t = 0; t < 120000; t += 250) { s = r.battle.advance(250); if (s.outcome !== 'ongoing') break } console.log(s.outcome)"
      const run = spawnSync(execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      expect(['victory', 'defeat']).toContain(run.stdout.trim())
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('an encounter battle', () => {
  it('is available for every ECO species, and the rules decide both outcomes', async () => {
    const all = await battles()
    const outcomes = new Set<string>()
    for (const speciesId of ECO_SPECIES) {
      const r = all.start({ battleId: `b-${speciesId}`, controllerId: CONTROLLER, speciesId, seed: 1234 })
      expect(r.ok, `species ${speciesId}`).toBe(true)
      if (r.ok) outcomes.add(runOut(r.battle))
    }
    expect(outcomes).toEqual(new Set(['victory', 'defeat']))
  }, 60_000)

  it('the player side is the labelled fixture; the wild side is the encounter species at the fixture level', async () => {
    const battle = await start(41)
    const s = battle.snapshot()
    const player = s.combatants['player-0']
    const wild = s.combatants['wild-0']
    expect(player.instance.speciesId).toBe(source.ECO_SANDBOX_FIXTURE.player.speciesId)
    expect(player.level).toBe(source.ECO_SANDBOX_FIXTURE.player.level)
    expect(player.instance.ownership.ownerId).toBe('eco-sandbox-fixture')
    expect(wild.instance.speciesId).toBe(41)
    expect(wild.level).toBe(source.ECO_SANDBOX_FIXTURE.wildLevel)
    expect(wild.instance.ownership.ownerId).toBeNull()
    expect(s.sides.find(side => side.sideId === 'player')?.controllerId).toBe(CONTROLLER)
    expect(s.sides.find(side => side.sideId === 'wild')?.controllerId).toBeNull()
  })

  it('capture and items are refused by the sandbox before the authority', async () => {
    const battle = await start()
    const capture = battle.submit(CONTROLLER, action(battle, 1, { kind: 'capture', combatantId: 'player-0', targetId: 'wild-0', ballId: 'poke-ball' }))
    const item = battle.submit(CONTROLLER, action(battle, 2, { kind: 'useItem', combatantId: 'player-0', targetId: 'player-0', item: { itemId: 'potion' } }))
    for (const r of [capture, item]) expect(r).toMatchObject({ kind: 'rejected', reason: source.SANDBOX_REJECTION })
  })

  it('the authority validates the rest: controller, sequence, duplicates and the end of the battle', async () => {
    const battle = await start()
    const move = firstMove(battle)
    expect(battle.submit('benchmark-intruder', action(battle, 1, { kind: 'useMove', combatantId: 'player-0', moveId: move, targetId: 'wild-0' }, 'benchmark-intruder'))).toMatchObject({ kind: 'rejected', reason: 'NOT_CONTROLLER' })
    const ok = action(battle, 3, { kind: 'useMove', combatantId: 'player-0', moveId: move, targetId: 'wild-0' })
    expect(battle.submit(CONTROLLER, ok).kind).toBe('accepted')
    expect(battle.submit(CONTROLLER, ok).kind).toBe('duplicate')
    expect(battle.submit(CONTROLLER, action(battle, 2, { kind: 'useMove', combatantId: 'player-0', moveId: move, targetId: 'wild-0' }))).toMatchObject({ kind: 'rejected', reason: 'STALE_ACTION' })
    expect(battle.submit(CONTROLLER, action(battle, 4, { kind: 'useMove', combatantId: 'wild-0', moveId: move, targetId: 'player-0' }))).toMatchObject({ kind: 'rejected', reason: 'NOT_CONTROLLER' })
    expect(battle.joinAck(CONTROLLER).nextActionSequence).toBe(4)
    runOut(battle)
    expect(battle.submit(CONTROLLER, action(battle, 9, { kind: 'useMove', combatantId: 'player-0', moveId: move, targetId: 'wild-0' }))).toMatchObject({ kind: 'rejected', reason: 'BATTLE_FINISHED' })
  })

  it('only the server moves its clock: no time, no change; a finished battle stays finished', async () => {
    const battle = await start()
    const before = battle.snapshot().timeMs
    battle.advance(0); battle.advance(-500); battle.advance(Number.NaN)
    expect(battle.snapshot().timeMs).toBe(before)
    expect(battle.elapsedMs()).toBe(0)
    const end = runOut(battle)
    const elapsed = battle.elapsedMs()
    battle.advance(10_000)
    expect(battle.outcome()).toBe(end)
    expect(battle.elapsedMs()).toBe(elapsed)
  })

  it('same seed, same battle (the server owns the seed); the bundle behaves like the sources', async () => {
    const trace = async (api: Api) => { const b = await start(19, 99, api); const log: string[] = []; for (let t = 0; t < 60_000 && b.outcome() === 'ongoing'; t += 250) log.push(JSON.stringify(b.advance(250).events)); return log.join('\n') + b.outcome() }
    expect(await trace(source)).toBe(await trace(source))
    expect(await trace(bundle as Api)).toBe(await trace(source))
  }, 60_000)

  it('fails closed: an invalid fixture prepares no battles; a species with no usable move gets none', async () => {
    expect(await source.prepareEncounterBattles({ player: { speciesId: 25, level: 12, moves: ['not-a-move'] }, wildLevel: 8 })).toEqual({ ok: false, reason: 'fixture-invalid' })
    const all = await battles()
    expect(all.start({ battleId: 'x', controllerId: CONTROLLER, speciesId: 999_999, seed: 1 })).toEqual({ ok: false, reason: 'battle-unavailable' })
  })
})
