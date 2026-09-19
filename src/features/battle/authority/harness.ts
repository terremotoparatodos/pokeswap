// A whole authoritative battle, in one call (R32.4).
//
// The end-to-end test, the malicious-input tests, the clock tests and the RNG
// tests all need the same three things: the real catalog, a clock a test can
// move, and a seed a test can pin. This builds them, so no test invents its
// own server and none of them can drift from what the room actually does.
//
// It is dev and test scaffolding — deliberately the only thing here that knows
// how to *pick* Pokémon. Production picks them from an encounter, and that is
// R34: this file must not grow one.

import type { BattleRulesCatalog, BattleRulesConfig, BattleSideInput } from '../rules'
// Directly, as every other caller of the fixtures does: the sample roster is
// dev scaffolding and deliberately not part of the rules' public barrel.
import { loadSampleRoster } from '../rules/sampleBattles'
import type { SampleFighter } from '../rules/sampleBattles'
import type { BattleAuthority, SupportedVersions } from './authority'
import { createManualClock } from './clock'
import type { ManualClock } from './clock'
import { createExpeditionRoom } from './expeditionRoom'
import type { ExpeditionRoom } from './expeditionRoom'
import { createFixedSeedSource } from './seed'
import type { AuthoritySeedSource } from './seed'

export interface AuthorityHarnessInput {
  readonly battleId?: string
  readonly roomId?: string
  /** The player's party, in order. The first one starts on the field. */
  readonly party: readonly SampleFighter[]
  /** The wild side. Server-owned: no controller commands it. */
  readonly wild: readonly SampleFighter[]
  readonly controllerId?: string
  /** Fixed by default: a test that wants a different battle says so. */
  readonly seed?: number
  readonly seedSource?: AuthoritySeedSource
  readonly startAtMs?: number
  readonly config?: BattleRulesConfig
  readonly supported?: SupportedVersions
}

export interface AuthorityHarness {
  readonly authority: BattleAuthority
  readonly room: ExpeditionRoom
  readonly clock: ManualClock
  readonly catalog: BattleRulesCatalog
  readonly controllerId: string
  readonly sessionId: string
  readonly battleId: string
  /** Catalog id of a move slug, so a test can send a real command. */
  moveId(slug: string): number
}

/**
 * Builds a room with one participant, one battle and a clock under the test's
 * hand.
 *
 * `startAtMs` defaults to a non-zero reading on purpose: a clock that starts
 * at zero hides the difference between "server time" and "battle time", and
 * that difference is the whole of §11.
 */
export async function createAuthorityHarness(input: AuthorityHarnessInput): Promise<AuthorityHarness> {
  const { catalog, build } = await loadSampleRoster()
  const controllerId = input.controllerId ?? 'controller-a'
  const battleId = input.battleId ?? 'harness-battle'
  const sessionId = 'session-a'
  const clock = createManualClock(input.startAtMs ?? 1_700_000_000_000)

  const sides: readonly BattleSideInput[] = [
    {
      sideId: 'ally',
      controllerId,
      party: input.party.map((fighter, index) => build(fighter, `ally-${index}`)),
    },
    {
      sideId: 'wild',
      controllerId: null,
      wild: true,
      party: input.wild.map((fighter, index) => build({ ...fighter, wild: true }, `wild-${index}`)),
    },
  ]

  const room = createExpeditionRoom({
    roomId: input.roomId ?? 'harness-room',
    clock,
    seedSource: input.seedSource ?? createFixedSeedSource(input.seed ?? 20260919),
    catalog,
    supported: input.supported,
  })
  room.join({ sessionId, controllerId })
  const authority = room.startBattle({ battleId, sides, config: input.config })

  return {
    authority,
    room,
    clock,
    catalog,
    controllerId,
    sessionId,
    battleId,
    moveId(slug) {
      const move = catalog.moveNamed(slug)
      if (!move) throw new Error(`move ${slug} is not in catalog ${catalog.catalogVersion}`)
      return move.id
    },
  }
}

/**
 * Builds a well-formed payload.
 *
 * It returns a plain record rather than a `TransportAction` on purpose: a test
 * that wants to break one field has to be able to, and a typed payload would
 * only be a promise the network does not keep anyway.
 */
export function actionPayload(
  harness: AuthorityHarness,
  actionId: string,
  intent: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    actionId,
    battleId: harness.battleId,
    catalogVersion: harness.catalog.catalogVersion,
    battleRulesVersion: harness.authority.snapshot().battleRulesVersion,
    intent,
    ...overrides,
  }
}
