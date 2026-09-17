// Dungeons as temporary overworld events (D1 §2, §3).
//
// APPROVED: a dungeon appears physically in WildLands for a while and then
// closes. The clock belongs to the **spawn**, not to the expedition: if forty
// seven minutes are left when you walk in, forty seven minutes is what you get.
//
// APPROVED, what happens at 00:00:
//   - the entrance stops accepting players;
//   - every active expedition ends and its players are auto-extracted;
//   - they keep all expedition loot and every capture already made;
//   - Floor Keys are lost;
//   - a fight still in progress pays nothing;
//   - it is **not** a wipe. A live Alpha at 00:00 gives no reward.
//
// PLAYTEST PARAMETER: three hours, and the warning marks. Configurable, not
// economy. SERVER AUTHORITY: the spawn clock, obviously — a client that owns
// `closesAt` owns how long the dungeon lasts.

import type { DungeonTier, DungeonTheme } from './tiers'

export type DungeonCategory = 'type' | 'generation' | 'special'

/** How a definition chooses its roster. The generator never hardcodes species. */
export type PoolRule =
  | { readonly kind: 'type'; readonly types: readonly string[] }
  | { readonly kind: 'generation'; readonly regions: readonly string[] }
  | { readonly kind: 'special'; readonly label: string; readonly tags: readonly string[] }

/** What a dungeon *is*. Stable while the entrance exists. */
export interface DungeonDefinition {
  readonly definitionId: string
  readonly name: string
  readonly category: DungeonCategory
  readonly theme: DungeonTheme
  readonly tier: DungeonTier
  /** Overworld biomes this entrance may appear in. Not used until the overworld is real. */
  readonly biomes: readonly string[]
  readonly pool: PoolRule
  /** Fixed length, so the entrance can advertise it. */
  readonly floors: number
  /** Species allowed to be the Alpha; a subset of the pool, or the pool itself. */
  readonly alphaPool?: readonly number[]
  readonly lootTableId: string
  /** Free-form switches a definition can carry (lucky chance, density…). */
  readonly modifiers?: Readonly<Record<string, number>>
}

export type SpawnStatus = 'open' | 'closing' | 'expired'

/** One concrete appearance of a definition. */
export interface DungeonSpawn {
  readonly spawnId: string
  readonly definitionId: string
  readonly position: { readonly tx: number; readonly ty: number; readonly areaId: string }
  /** Milliseconds on whatever clock the caller uses; the server's own later. */
  readonly startedAt: number
  readonly closesAt: number
  readonly status: SpawnStatus
  /** The seed of the *entrance*; each expedition derives its own from it. */
  readonly seed: number
}

/** PLAYTEST PARAMETER: three hours. */
export const DEFAULT_DUNGEON_MINUTES = 180

/** PLAYTEST PARAMETER: when the player is told. */
export const WARNING_MINUTES: readonly number[] = [30, 10, 5, 1]

export interface SpawnInput {
  readonly spawnId: string
  readonly definition: DungeonDefinition
  readonly position: DungeonSpawn['position']
  readonly now: number
  readonly minutes?: number
  readonly seed: number
}

export const createSpawn = (input: SpawnInput): DungeonSpawn => ({
  spawnId: input.spawnId,
  definitionId: input.definition.definitionId,
  position: input.position,
  startedAt: input.now,
  closesAt: input.now + (input.minutes ?? DEFAULT_DUNGEON_MINUTES) * 60_000,
  status: 'open',
  seed: input.seed,
})

export const millisLeft = (spawn: DungeonSpawn, now: number): number => Math.max(0, spawn.closesAt - now)

export const minutesLeft = (spawn: DungeonSpawn, now: number): number => millisLeft(spawn, now) / 60_000

export const hasExpired = (spawn: DungeonSpawn, now: number): boolean => now >= spawn.closesAt

/** `mm:ss` for the HUD, which is what the player actually reads. */
export function formatCountdown(spawn: DungeonSpawn, now: number): string {
  const total = Math.floor(millisLeft(spawn, now) / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** The entrance refuses new players once the clock runs out. */
export const acceptsEntries = (spawn: DungeonSpawn, now: number): boolean =>
  spawn.status !== 'expired' && !hasExpired(spawn, now)

export function advanceSpawn(spawn: DungeonSpawn, now: number): DungeonSpawn {
  if (hasExpired(spawn, now)) return spawn.status === 'expired' ? spawn : { ...spawn, status: 'expired' }
  const closing = minutesLeft(spawn, now) <= WARNING_MINUTES[0]
  const status: SpawnStatus = closing ? 'closing' : 'open'
  return status === spawn.status ? spawn : { ...spawn, status }
}

/**
 * Which warning to show, given how much was left last time we looked. Returns
 * null unless a mark was crossed between the two readings, so the HUD can fire
 * it once instead of every frame.
 */
export function crossedWarning(previousMinutes: number, currentMinutes: number): number | null {
  for (const mark of WARNING_MINUTES) {
    if (previousMinutes > mark && currentMinutes <= mark) return mark
  }
  return null
}

export type ExpirationOutcome = 'DUNGEON_EXPIRED → AUTO_EXTRACT'

export interface ExpirationNotice {
  readonly outcome: ExpirationOutcome
  /** Everything already earned is kept; this says so explicitly for the report. */
  readonly keepsLoot: true
  readonly keepsCaptures: true
  readonly losesKeys: true
  /** A fight still running when the clock hits zero pays nothing. */
  readonly rewardsUnfinishedCombat: false
  /** It is not a wipe: nobody goes to a Pokémon Center over it. */
  readonly countsAsWipe: false
  /** True when the Alpha was still standing, and therefore paid nothing. */
  readonly alphaUnrewarded: boolean
}

export const expirationNotice = (alphaAlive: boolean): ExpirationNotice => ({
  outcome: 'DUNGEON_EXPIRED → AUTO_EXTRACT',
  keepsLoot: true,
  keepsCaptures: true,
  losesKeys: true,
  rewardsUnfinishedCombat: false,
  countsAsWipe: false,
  alphaUnrewarded: alphaAlive,
})
