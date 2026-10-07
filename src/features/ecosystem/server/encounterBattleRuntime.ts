// A test battle against one ECO encounter, as the realtime service consumes it (ECO-GAMEPLAY-2,
// development sandbox only).
//
// This file is the ONLY entry of `scripts/integration/bundle-battle.mjs`: everything exported here —
// and nothing else — is in `services/realtime/src/world/ecosystem/encounterBattle.generated.js`.
//
// It WRAPS the existing battle authority (src/features/battle/authority) and never changes it: the
// authority owns the seed, the rules, the validation and the idempotency ledger; this module only
// builds the two sides from SYNTHETIC FIXTURES, gives the authority a battle clock the server
// advances, refuses the intents the sandbox does not offer (capture, items), and reads the outcome
// the rules decided. The client never declares a result.
//
// Nothing here grants anything: the player's Pokémon is a fixture (`ownerId` 'eco-sandbox-fixture'),
// the wild one belongs to nobody, and a finished battle writes nowhere. No clock, randomness or I/O
// of its own: the server supplies the seed and advances the clock.

import { REJECTION, createBattleAuthority, createFixedSeedSource, createManualClock } from '../../battle/authority'
import type { AuthorityEventEnvelope, AuthoritySubmitResult, BattleAuthority, ClientBattleSnapshot, JoinAck, ManualClock } from '../../battle/authority'
import { loadBattleCatalog, loadLearnsets } from '../../battle/catalog'
import { createBattleRulesCatalog, isExecutable } from '../../battle/rules'
import type { BattleRulesCatalog } from '../../battle/rules'
import { PERFECT_IVS, ZERO_STATS, createPokemonCatalogView, createPokemonInstance } from '../../pokemon/model'
import type { PokemonInstance } from '../../pokemon/model'

/** Bundle contract version: bump when the exported surface changes shape. */
export const ECO_BATTLE_API = 1

/**
 * SYNTHETIC TEST FIXTURES — not balance, not a player's team. Shown to players as «fixture de prueba».
 * The player fights with this one Pokémon; the wild side is the encounter's species at `wildLevel`.
 */
export const ECO_SANDBOX_FIXTURE = Object.freeze({
  label: 'fixture de prueba',
  ownerId: 'eco-sandbox-fixture',
  player: Object.freeze({ speciesId: 25, level: 12, moves: Object.freeze(['thunder-shock', 'quick-attack', 'thunder-wave', 'double-team']) }),
  wildLevel: 8,
})

export type SandboxFixture = { readonly player: { readonly speciesId: number; readonly level: number; readonly moves: readonly string[] }; readonly wildLevel: number }

/** Intents the sandbox offers. Capture and items are refused before they reach the authority. */
const SANDBOX_INTENTS = new Set(['useMove', 'switch', 'clearSelection'])
export const SANDBOX_REJECTION = 'NOT_ALLOWED_IN_SANDBOX'

export type EncounterOutcome = 'ongoing' | 'victory' | 'defeat'

export interface BattleStep {
  readonly events: readonly AuthorityEventEnvelope[]
  readonly snapshot: ClientBattleSnapshot
  readonly outcome: EncounterOutcome
}

/** One running test battle. The realtime service holds it; nothing in it persists. */
export interface EncounterBattle {
  readonly battleId: string
  /** Advances the battle clock by `ms` (the server decides when time passes) and returns what happened. */
  advance(ms: number): BattleStep
  /** One untrusted action from the controller the TRANSPORT authenticated. */
  submit(controllerId: string, payload: unknown): AuthoritySubmitResult
  snapshot(): ClientBattleSnapshot
  joinAck(controllerId: string): JoinAck
  outcome(): EncounterOutcome
  /** Battle time elapsed (only the time the server advanced). */
  elapsedMs(): number
}

export type StartResult =
  | { readonly ok: true; readonly battle: EncounterBattle }
  | { readonly ok: false; readonly reason: 'battle-unavailable' }

export interface EncounterBattles {
  readonly fixture: SandboxFixture
  start(input: { readonly battleId: string; readonly controllerId: string; readonly speciesId: number; readonly seed: number }): StartResult
}

export type PrepareResult =
  | { readonly ok: true; readonly battles: EncounterBattles }
  | { readonly ok: false; readonly reason: string }

const FIXED_AT = '2026-01-01T00:00:00.000Z' // a fixture's acquisition stamp: constant, never a clock

/** Loads the battle catalog once and checks the fixture against it. Fails closed. */
export async function prepareEncounterBattles(fixture: SandboxFixture = ECO_SANDBOX_FIXTURE): Promise<PrepareResult> {
  let index, learnsets
  try {
    [index, learnsets] = await Promise.all([loadBattleCatalog(), loadLearnsets()])
  } catch {
    return { ok: false, reason: 'catalog-unavailable' }
  }
  const modelView = createPokemonCatalogView(index, learnsets)
  const catalog: BattleRulesCatalog = createBattleRulesCatalog(index)
  const hardy = index.catalog.natures.find(nature => nature.name === 'hardy')
  if (!hardy) return { ok: false, reason: 'fixture-invalid' }

  const playerMoveIds: number[] = []
  for (const name of fixture.player.moves) {
    const move = index.moveNamed(name)
    if (!move || !isExecutable(move)) return { ok: false, reason: 'fixture-invalid' }
    playerMoveIds.push(move.id)
  }

  /** The wild side's moves: the last four executable level-up moves at or below the fixture level. */
  const wildMoves = (speciesId: number): number[] => {
    const learnset = learnsets.get(speciesId)
    if (!learnset) return []
    // Level entries are `[moveId, level]` (CatalogLearnset).
    const learned = [...learnset.level]
      .filter(([moveId, level]) => level <= fixture.wildLevel && (() => { const move = index.move(moveId); return Boolean(move && isExecutable(move)) })())
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .map(([moveId]) => moveId)
    return [...new Set(learned)].slice(-4)
  }

  const instance = (speciesId: number, level: number, moveIds: readonly number[], ownerId: string | null, instanceId: string): PokemonInstance | null => {
    try {
      return createPokemonInstance(
        { speciesId, level, moveIds: [...moveIds], natureId: hardy.id, ivs: PERFECT_IVS, evs: ZERO_STATS, shiny: false, gender: 'genderless', ownerId, acquisition: { source: 'event', at: FIXED_AT, catalogVersion: index.catalogVersion } },
        modelView, () => 0.5, instanceId,
      )
    } catch {
      return null
    }
  }
  if (!instance(fixture.player.speciesId, fixture.player.level, playerMoveIds, ECO_SANDBOX_FIXTURE.ownerId, 'fixture-check')) return { ok: false, reason: 'fixture-invalid' }

  const battles: EncounterBattles = {
    fixture,
    start({ battleId, controllerId, speciesId, seed }) {
      const moves = wildMoves(speciesId)
      const player = instance(fixture.player.speciesId, fixture.player.level, playerMoveIds, ECO_SANDBOX_FIXTURE.ownerId, `${battleId}:player`)
      const wild = moves.length ? instance(speciesId, fixture.wildLevel, moves, null, `${battleId}:wild`) : null
      if (!player || !wild) return { ok: false, reason: 'battle-unavailable' }
      const clock: ManualClock = createManualClock(0)
      let authority: BattleAuthority
      try {
        authority = createBattleAuthority({
          battleId, catalog, clock, seedSource: createFixedSeedSource(seed),
          sides: [
            { sideId: 'player', controllerId, party: [player] },
            { sideId: 'wild', controllerId: null, party: [wild], wild: true },
          ],
        })
      } catch {
        return { ok: false, reason: 'battle-unavailable' }
      }
      const outcome = (): EncounterOutcome => {
        const decided = authority.snapshot().outcome
        if (decided.kind !== 'decided') return 'ongoing'
        return decided.winningSideId === 'player' ? 'victory' : 'defeat'
      }
      let elapsed = 0
      return {
        ok: true,
        battle: {
          battleId,
          advance(ms) {
            if (Number.isFinite(ms) && ms > 0 && outcome() === 'ongoing') { clock.advance(ms); elapsed += ms }
            const events = authority.tick()
            return { events, snapshot: authority.snapshot(), outcome: outcome() }
          },
          submit(controller, payload) {
            const kind = (payload as { intent?: { kind?: unknown } } | null)?.intent?.kind
            if (typeof kind === 'string' && !SANDBOX_INTENTS.has(kind)) {
              const actionId = (payload as { actionId?: unknown }).actionId
              return { kind: 'rejected', reason: SANDBOX_REJECTION as never, actionId: typeof actionId === 'string' ? actionId : null, revision: authority.revision() }
            }
            return authority.submit(controller, payload)
          },
          snapshot: () => authority.snapshot(),
          joinAck: controller => authority.joinAck(controller),
          outcome,
          elapsedMs: () => elapsed,
        },
      }
    },
  }
  return { ok: true, battles }
}

export { REJECTION }
