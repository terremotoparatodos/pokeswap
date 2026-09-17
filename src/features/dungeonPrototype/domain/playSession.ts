// The whole run, in one place (D1 §55).
//
// PLAY DUNGEON is the loop the human playtest needs: walk in, cross floors,
// pick your fights, find the key, wear down, capture, retreat or wipe, and
// reach the Alpha. This module owns that state machine and nothing else — the
// rules live in the modules it calls, and the clock comes from outside.
//
// Pure: no Vue, no DOM, no timers of its own.

import { alphaCombatModifiers } from './alpha'
import {
  abortBattle, createBattle, prepare, type BattleState, type PreparedAction,
} from './battle'
import { createBossController, type BossController } from './bossFight'
import { bossKitFor, type BossSkill } from './bossSkills'
import { advanceSpawn, crossedWarning, expirationNotice, hasExpired, minutesLeft, type DungeonDefinition, type DungeonSpawn } from './dungeonSpawn'
import {
  addExpeditionCapture, addExpeditionLoot, advanceFloor, consumeItem, grantKey, retreat,
  shouldWipe, startExpedition, wipe, type ExpeditionResult, type ExpeditionState,
} from './expedition'
import { generateFloor, type FloorPlan } from './floorPlan'
import { rollFloorKey } from './floorKey'
import {
  buildFloorTiles, isAdjacent, isWalkable, placeEntities, samePoint,
  type FloorEntity, type FloorTiles, type TilePoint,
} from './floorTiles'
import { isObstacleTile, OBSTACLES, placeObstacles, type FloorObstacle } from './obstacles'
import { cloneParty, isFainted, type PokemonInstance } from './party'
import { createRng, streamFor, type Rng } from './rng'
import { dungeonProfile, type DungeonProfile } from './tiers'

export type PlayPhase = 'exploring' | 'combat' | 'antechamber' | 'boss' | 'ended'

export interface LuckyBuff {
  readonly label: string
  /** Battle-independent seconds of dungeon clock. */
  until: number
  readonly lootBonus: number
}

export interface PlaySession {
  readonly definition: DungeonDefinition
  readonly spawn: DungeonSpawn
  readonly profile: DungeonProfile
  /** Milliseconds on the session clock; the lab may run it faster than real time. */
  now: number
  phase: PlayPhase
  expedition: ExpeditionState
  plan: FloorPlan
  tiles: FloorTiles
  entities: FloorEntity[]
  /** Rockfalls and barricades sealing side pockets (D1.2.4 §1). */
  obstacles: FloorObstacle[]
  player: TilePoint
  battle: BattleState | null
  boss: BossController | null
  bossKit: readonly BossSkill[]
  /** The encounter currently being fought, so its entity can be cleared. */
  engagedId: string | null
  lucky: LuckyBuff | null
  result: ExpeditionResult | null
  log: string[]
  /** Minutes left as of the last tick, for the warning marks. */
  lastMinutes: number
  warning: number | null
  readonly items: Readonly<Record<string, number>>
  readonly rng: Rng
  readonly pool: readonly number[]
}

export interface StartPlayInput {
  readonly definition: DungeonDefinition
  readonly spawn: DungeonSpawn
  readonly party: readonly PokemonInstance[]
  readonly inventory: Readonly<Record<string, number>>
  readonly pool: readonly number[]
  readonly now: number
  /** Each expedition rolls its own seed from the spawn's (§5). */
  readonly expeditionSeed?: number
}

const say = (session: PlaySession, text: string): void => {
  session.log = [text, ...session.log].slice(0, 30)
}

export function startPlay(input: StartPlayInput): PlaySession {
  const seed = input.expeditionSeed ?? streamFor(input.spawn.seed, 'expedition', input.now).int(1, 1_000_000)
  const profile: DungeonProfile = {
    ...dungeonProfile(seed, input.definition.tier, input.definition.theme),
    name: input.definition.name,
    floors: input.definition.floors,
  }
  const plan = generateFloor(profile, 1, input.pool)
  const tiles = buildFloorTiles(plan, input.definition.theme, seed)
  const session: PlaySession = {
    definition: input.definition,
    spawn: input.spawn,
    profile,
    now: input.now,
    phase: 'exploring',
    expedition: startExpedition({
      expeditionId: `exp-${seed}`,
      seed,
      floors: input.definition.floors,
      party: cloneParty(input.party),
      carriedInventory: input.inventory,
    }),
    plan,
    tiles,
    entities: placeEntities(plan, tiles, seed, input.definition.modifiers?.luckyChance ?? 0.1),
    obstacles: placeObstacles(tiles, seed, plan.floor),
    player: tiles.entrance,
    battle: null,
    boss: null,
    bossKit: [],
    engagedId: null,
    lucky: null,
    result: null,
    log: [],
    lastMinutes: minutesLeft(input.spawn, input.now),
    warning: null,
    items: { ...input.inventory },
    rng: createRng(seed),
    pool: input.pool,
  }
  say(session, `Entrás a ${input.definition.name}. ${input.definition.floors} pisos.`)
  return session
}

// ── Exploration ────────────────────────────────────────────────────────────

export function move(session: PlaySession, dx: number, dy: number): boolean {
  if (session.phase !== 'exploring') return false
  const next = { x: session.player.x + dx, y: session.player.y + dy }
  if (!isWalkable(session.tiles, next.x, next.y)) return false
  // D1.2.4 §1: a rockfall or a barricade has to be cleared first.
  if (isObstacleTile(session.obstacles, next.x, next.y)) return false
  // APPROVED (§7): walking past a Pokémon does nothing. There is no aggro.
  const blocking = session.entities.find(entity =>
    !entity.taken && entity.kind !== 'chest' && samePoint(entity.at, next))
  if (blocking) return false
  session.player = next
  return true
}

export const entityAt = (session: PlaySession, point: TilePoint): FloorEntity | undefined =>
  session.entities.find(entity => !entity.taken && samePoint(entity.at, point))

/** What the player could interact with from where they stand. */
export const reachable = (session: PlaySession): FloorEntity[] =>
  session.entities.filter(entity => !entity.taken
    && (isAdjacent(session.player, entity.at) || samePoint(session.player, entity.at)))

export const atStairs = (session: PlaySession): boolean => samePoint(session.player, session.tiles.exit)

// ── Combat ─────────────────────────────────────────────────────────────────

export interface CombatDeps {
  readonly buildWild: (speciesId: number, level: number) => PokemonInstance
  readonly combatantFor: (pokemon: PokemonInstance) => { pokemon: PokemonInstance; species: { speciesId: number; name: string; types: readonly string[]; baseStats: readonly number[]; catchRate: number }; stages: Record<string, number> }
  readonly items: Readonly<Record<string, { id: string; name: string; kind: string; amount: number }>>
}

/** The player chooses to fight. Nothing starts a fight on its own. */
export function engage(session: PlaySession, entityId: string, deps: {
  makeWild: (speciesId: number, level: number) => PokemonInstance
  makeCombatant: (pokemon: PokemonInstance) => BattleState['actors'][number]['combatant']
  battleItems: BattleState['items']
}): boolean {
  if (session.phase !== 'exploring') return false
  const entity = session.entities.find(candidate => candidate.id === entityId && !candidate.taken)
  if (!entity || entity.kind === 'chest') return false
  if (!isAdjacent(session.player, entity.at)) return false

  const party = session.expedition.party.filter(member => !isFainted(member))
  if (!party.length) return false
  const wild = deps.makeWild(entity.speciesId ?? 74, entity.level ?? 5)
  session.battle = createBattle({
    allies: [{ combatant: deps.makeCombatant(party[0]) }],
    enemies: [deps.makeCombatant(wild)],
    bench: { p1: party.slice(1) },
    items: deps.battleItems,
    rng: streamFor(session.expedition.seed, 'fight', session.expedition.floor, entity.id),
    // A switch has to bring its own species with it (D1.2.3).
    speciesFor: pokemon => deps.makeCombatant(pokemon).species,
  })
  session.engagedId = entity.id
  session.phase = 'combat'
  say(session, `Combate contra ${entity.kind === 'lucky' ? 'un Pokémon con suerte' : 'un Pokémon salvaje'}.`)
  return true
}

export const act = (session: PlaySession, action: PreparedAction): boolean =>
  session.battle ? prepare(session.battle, 'ally-0', action) : false

/** Called when the battle reaches an outcome. */
export function settleCombat(session: PlaySession, lootFor: () => { itemId: string; quantity: number }[]): void {
  const battle = session.battle
  if (!battle || battle.outcome === 'ongoing') return
  const entity = session.entities.find(candidate => candidate.id === session.engagedId)

  if (battle.outcome === 'victory' || battle.outcome === 'captured') {
    if (entity) entity.taken = true
    const rng = streamFor(session.expedition.seed, 'reward', session.expedition.floor, entity?.id ?? 'x')

    if (battle.outcome === 'captured' && entity) {
      session.expedition = addExpeditionCapture(session.expedition, {
        instanceId: battle.capturedInstanceId ?? `${entity.id}-catch`,
        speciesId: entity.speciesId ?? 0,
        level: entity.level ?? 1,
        floor: session.expedition.floor,
      })
      say(session, 'Capturado. Es botín de expedición: no es tuyo hasta que salgas.')
    }

    // APPROVED (§11): a Lucky Pokémon grants a temporary loot buff. Concept
    // only — the formula is OPEN and this one is a placeholder.
    if (entity?.kind === 'lucky') {
      session.lucky = { label: 'Suerte', until: session.now + 120_000, lootBonus: 1 }
      say(session, 'Buff de suerte activo por 2 minutos (concepto, sin balance).')
    }

    const roll = rollFloorKey(session.expedition.key, rng.next())
    if (roll.dropped) {
      session.expedition = grantKey(session.expedition, roll.state)
      say(session, roll.guaranteed ? 'Llave de piso (garantizada).' : 'Llave de piso.')
    }
    const drops = lootFor()
    if (drops.length) {
      session.expedition = addExpeditionLoot(session.expedition, drops)
      say(session, `Botín: ${drops.map(drop => `${drop.itemId} ×${drop.quantity}`).join(', ')}`)
    }
  } else if (battle.outcome === 'aborted') {
    // D1.2.4 §5: running away costs the fight, not the run. The Pokémon stays
    // on the floor and can be fought again.
    say(session, session.phase === 'boss' ? 'El combate se interrumpió.' : 'Huiste del combate.')
  } else {
    say(session, 'Derrota.')
  }

  session.battle = null
  session.engagedId = null
  session.phase = session.phase === 'boss' ? 'ended' : 'exploring'
  if (shouldWipe(session.expedition)) endRun(session, 'wipe')
}

/**
 * Obstacles within arm's reach: what the CTA offers (D1.2.4 §1). A barrier is
 * several tiles wide, so standing next to any of them is standing next to it.
 */
const withinReach = (session: PlaySession, obstacle: FloorObstacle): boolean =>
  obstacle.tiles.some(at => isAdjacent(session.player, at))

export const obstaclesInReach = (session: PlaySession): FloorObstacle[] =>
  session.obstacles.filter(obstacle => !obstacle.cleared && withinReach(session, obstacle))

/**
 * Breaks a rockfall or a barricade open. D1.2.4 §4: this is a way past, not a
 * way to farm — it yields nothing but the tile.
 */
export function clearObstacle(session: PlaySession, obstacleId: string): boolean {
  if (session.phase !== 'exploring') return false
  const obstacle = session.obstacles.find(candidate => candidate.id === obstacleId && !candidate.cleared)
  if (!obstacle || !withinReach(session, obstacle)) return false
  obstacle.cleared = true
  const definition = OBSTACLES[obstacle.kind]
  say(session, `${definition.label}: despejado. El paso queda abierto.`)
  return true
}

export function openChest(session: PlaySession, entityId: string, loot: () => { itemId: string; quantity: number }[]): boolean {
  const entity = session.entities.find(candidate => candidate.id === entityId && !candidate.taken)
  if (!entity || entity.kind !== 'chest') return false
  if (!isAdjacent(session.player, entity.at) && !samePoint(session.player, entity.at)) return false
  entity.taken = true
  const drops = loot()
  session.expedition = addExpeditionLoot(session.expedition, drops)
  say(session, `Cofre (${entity.rarity}): ${drops.map(drop => `${drop.itemId} ×${drop.quantity}`).join(', ')}`)
  return true
}

export function useItem(session: PlaySession, itemId: string, apply: (state: ExpeditionState) => void): boolean {
  const spent = consumeItem(session.expedition, itemId)
  if (!spent.used) return false
  session.expedition = spent.state
  apply(session.expedition)
  say(session, `Usaste ${itemId}.`)
  return true
}

// ── Floors ─────────────────────────────────────────────────────────────────

export function descend(session: PlaySession): boolean {
  if (session.phase !== 'exploring' || !atStairs(session)) return false
  const isLast = session.expedition.floor + 1 >= session.expedition.floors
  const moved = advanceFloor(session.expedition)
  if (!moved.advanced) {
    say(session, moved.reason === 'no-key' ? 'La puerta está cerrada: necesitás una llave.' : 'No hay más pisos.')
    return false
  }
  session.expedition = moved.state
  session.plan = generateFloor(session.profile, session.expedition.floor, session.pool)
  session.tiles = buildFloorTiles(session.plan, session.definition.theme, session.expedition.seed)
  session.entities = placeEntities(
    session.plan, session.tiles, session.expedition.seed, session.definition.modifiers?.luckyChance ?? 0.1,
  )
  session.obstacles = placeObstacles(session.tiles, session.expedition.seed, session.plan.floor)
  session.player = session.tiles.entrance
  say(session, `Piso ${session.expedition.floor}. HP y PP siguen como estaban.`)
  if (isLast) say(session, 'El último piso: el Alpha te espera.')
  return true
}

/** APPROVED (§14): information and a confirmation. No healing, no restoring. */
export function enterAntechamber(session: PlaySession): boolean {
  if (session.phase !== 'exploring') return false
  if (session.expedition.floor < session.expedition.floors) return false
  if (!atStairs(session)) return false
  session.phase = 'antechamber'
  say(session, 'Antecámara: revisá el equipo. Acá no se cura nada.')
  return true
}

export function startBoss(session: PlaySession, deps: {
  makeWild: (speciesId: number, level: number) => PokemonInstance
  makeCombatant: (pokemon: PokemonInstance) => BattleState['actors'][number]['combatant']
  battleItems: BattleState['items']
  players: number
}): boolean {
  if (session.phase !== 'antechamber') return false
  const alpha = session.plan.encounters.find(encounter => encounter.isAlpha)
  if (!alpha) return false
  const party = session.expedition.party.filter(member => !isFainted(member))
  if (!party.length) return false

  const scaling = alphaCombatModifiers(session.definition.tier, deps.players, 1)
  const boss = deps.makeWild(alpha.speciesId, alpha.level)
  const scaledHp = Math.round(boss.maxHp * scaling.hpMultiplier)
  boss.hp = scaledHp
  Object.assign(boss, { maxHp: scaledHp })

  // APPROVED (§35, §36): solo brings two active Pokémon, a group one each.
  const active = deps.players <= 1 ? Math.min(2, party.length) : 1
  session.battle = createBattle({
    allies: party.slice(0, active).map(pokemon => ({ combatant: deps.makeCombatant(pokemon) })),
    enemies: [{ ...deps.makeCombatant(boss), modifiers: scaling.modifiers }],
    bench: { p1: party.slice(active) },
    items: deps.battleItems,
    rng: streamFor(session.expedition.seed, 'boss'),
    speciesFor: pokemon => deps.makeCombatant(pokemon).species,
  })
  const kitRng = streamFor(session.expedition.seed, 'bossKit')
  session.bossKit = bossKitFor(session.definition.tier, (min, max) => kitRng.int(min, max), items => kitRng.shuffle(items))
  session.boss = createBossController('enemy-0', session.bossKit)
  session.phase = 'boss'
  say(session, `¡Alpha! ${session.bossKit.length} Boss Skills.`)
  return true
}

// ── Ending ─────────────────────────────────────────────────────────────────

export function endRun(session: PlaySession, kind: 'retreat' | 'wipe' | 'expired'): ExpeditionResult {
  const outcome = kind === 'wipe' ? wipe(session.expedition) : retreat(session.expedition)
  session.expedition = outcome.state
  session.result = outcome
  session.phase = 'ended'
  if (session.battle) abortBattle(session.battle, 'Fin de la expedición')
  say(session, kind === 'retreat' ? 'Te retirás con tu botín.'
    : kind === 'wipe' ? 'Wipe: Centro Pokémon y perdés lo de adentro.'
      : 'La Dungeon cerró: extracción automática.')
  return outcome
}

// ── Clock ──────────────────────────────────────────────────────────────────

/**
 * Advances the dungeon clock. The expiry is the spawn's, not the run's: when
 * it hits zero everyone is extracted with what they already have.
 */
export function advanceClock(session: PlaySession, deltaMs: number): void {
  if (session.phase === 'ended') return
  session.now += deltaMs
  const minutes = minutesLeft(session.spawn, session.now)
  const mark = crossedWarning(session.lastMinutes, minutes)
  if (mark !== null) {
    session.warning = mark
    say(session, `Quedan ${mark} minutos.`)
  }
  session.lastMinutes = minutes
  Object.assign(session, { spawn: advanceSpawn(session.spawn, session.now) })

  if (session.lucky && session.now >= session.lucky.until) {
    session.lucky = null
    say(session, 'El buff de suerte terminó.')
  }

  if (hasExpired(session.spawn, session.now)) {
    const alphaAlive = session.phase === 'boss' && session.battle?.outcome === 'ongoing'
    const notice = expirationNotice(Boolean(alphaAlive))
    if (alphaAlive) say(session, 'El Alpha seguía vivo: no entrega recompensa.')
    endRun(session, 'expired')
    Object.assign(session, { expirationNotice: notice })
  }
}

export const countdownMs = (session: PlaySession): number => Math.max(0, session.spawn.closesAt - session.now)
