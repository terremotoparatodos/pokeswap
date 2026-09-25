// Everything a playtester owns, for as long as the tab is open.
//
// Singleton and session-only. Nothing here is written anywhere: no Supabase, no
// localStorage, no socket. A refresh is a reset, which is the honest behaviour
// for a build whose banner says the progress does not survive, and it is also
// the reason none of this can corrupt a real account.
//
// It deliberately knows nothing about the Skills feature. The party is handed
// down by `WildlandsView` as a prop, so the Pokémon that work cross the
// feature boundary as data rather than as an import.

import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue'
import type { PokemonInstance } from '../../dungeonPrototype/domain/party'
import {
  applyExpedition, boxMembers, createRoster, healParty, needsHealing, partyMembers, toBox, toParty,
  type PlaytestRoster, type RosterChange,
} from '../domain/playtestRoster'
import { PLAYTEST_OWNER } from '../domain/playtestRoster'
import { PLAYTEST_START_COINS, buy, type ShopEntry } from '../domain/playtestShop'

/**
 * PLAYTEST PARAMETER: what you walk in with.
 *
 * Six balls and a couple of potions, the same loadout the Dungeon prototype
 * always assumed, so a first run is possible without visiting the Tienda.
 */
const STARTING_SUPPLIES: Readonly<Record<string, number>> = { poke_ball: 6, potion: 2, revive: 1, ether: 2 }

const coins = ref(PLAYTEST_START_COINS)
const supplies = ref<Record<string, number>>({ ...STARTING_SUPPLIES })
/**
 * Empty until somebody asks for it.
 *
 * Seeding the roster at module scope made this module have a side effect on
 * import, and a module with a side effect cannot be tree-shaken: a normal
 * production build ended up carrying the Dungeon prototype's species fixtures
 * because of this one line. Building it on first use keeps the module inert.
 */
const roster = ref<PlaytestRoster>({ all: [], party: { ownerId: PLAYTEST_OWNER, memberIds: [] } })
const notice = ref<string | null>(null)
let seeded = false

export interface PlaytestStore {
  readonly coins: Readonly<Ref<number>>
  /** Dungeon consumables by prototype item id, including `poke_ball`. */
  readonly supplies: Readonly<Ref<Record<string, number>>>
  readonly party: ComputedRef<PokemonInstance[]>
  readonly box: ComputedRef<PokemonInstance[]>
  readonly hurt: ComputedRef<boolean>
  /** One short sentence about the last thing that happened, or null. */
  readonly notice: Readonly<Ref<string | null>>

  purchase(entryId: string): { ok: boolean; entry?: ShopEntry; message: string }
  heal(): void
  /** Takes back the party a Dungeon run wore down. Condition only, never new Pokémon. */
  returnFromExpedition(party: readonly PokemonInstance[] | null | undefined): void
  addToParty(instanceId: string): RosterChange
  sendToBox(instanceId: string): RosterChange
  clearNotice(): void
  /** After the stream: back to a fresh session without reloading. */
  reset(): void
}

const REFUSAL_MESSAGE: Readonly<Record<string, string>> = {
  unknown: 'Eso no está a la venta.',
  poor: 'No te alcanzan las fichas.',
  full: 'El equipo ya tiene 6. Mandá uno a la caja primero.',
  'already-in-party': 'Ese ya está en el equipo.',
  'not-in-party': 'Ese no está en el equipo.',
  'last-one': 'No podés quedarte sin ningún Pokémon.',
}

export function usePlaytestStore(): PlaytestStore {
  if (!seeded) {
    seeded = true
    roster.value = createRoster()
  }
  return {
    coins: readonly(coins) as Readonly<Ref<number>>,
    supplies: readonly(supplies) as Readonly<Ref<Record<string, number>>>,
    party: computed(() => partyMembers(roster.value)),
    box: computed(() => boxMembers(roster.value)),
    hurt: computed(() => needsHealing(roster.value)),
    notice: readonly(notice) as Readonly<Ref<string | null>>,

    /**
     * One purchase, decided by the pure rule and then applied.
     *
     * The balance the rule returns is the one that gets stored, rather than a
     * subtraction done here, so two fast clicks cannot each debit a balance
     * neither of them saw the other change.
     */
    purchase(entryId): { ok: boolean; entry?: ShopEntry; message: string } {
      const result = buy({ entryId, coins: coins.value })
      if (!result.ok) {
        notice.value = REFUSAL_MESSAGE[result.reason] ?? 'No se pudo.'
        return { ok: false, message: notice.value }
      }
      coins.value = result.coins
      const effect = result.entry.effect
      if (effect.kind === 'ball') {
        supplies.value = { ...supplies.value, poke_ball: (supplies.value.poke_ball ?? 0) + effect.quantity }
      } else if (effect.kind === 'consumable') {
        supplies.value = { ...supplies.value, [effect.itemId]: (supplies.value[effect.itemId] ?? 0) + effect.quantity }
      }
      notice.value = `${result.entry.name} — listo.`
      return { ok: true, entry: result.entry, message: notice.value }
    },

    heal(): void {
      roster.value = healParty(roster.value)
      notice.value = 'Tu equipo está como nuevo.'
    },

    returnFromExpedition(party): void {
      if (!party?.length) return
      roster.value = applyExpedition(roster.value, party)
      if (needsHealing(roster.value)) notice.value = 'Tu equipo volvió golpeado. Pasá por el Centro Pokémon.'
    },

    addToParty(instanceId): RosterChange {
      const change = toParty(roster.value, instanceId)
      if (change.ok) roster.value = change.roster
      else notice.value = REFUSAL_MESSAGE[change.reason] ?? 'No se pudo.'
      return change
    },

    sendToBox(instanceId): RosterChange {
      const change = toBox(roster.value, instanceId)
      if (change.ok) roster.value = change.roster
      else notice.value = REFUSAL_MESSAGE[change.reason] ?? 'No se pudo.'
      return change
    },

    clearNotice(): void {
      notice.value = null
    },

    reset(): void {
      coins.value = PLAYTEST_START_COINS
      supplies.value = { ...STARTING_SUPPLIES }
      roster.value = createRoster()
      notice.value = null
    },
  }
}
