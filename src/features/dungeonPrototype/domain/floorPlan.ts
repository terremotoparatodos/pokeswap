// Floor generation (D1): rooms, links, encounters, loot and the locked exit.
//
// Deterministic from (seed, tier, floor). The plan is data only — no canvas, no
// engine, no Vue — so the lab can draw it, a test can assert it, and a server
// can one day regenerate and validate the same floor from the same seed.
//
// PROTOTYPE ASSUMPTION: every shape and count below. What matters for review is
// that the floor is conditioned by seed + tier + floor + theme, and that it
// grows with the difficulty budget instead of being free-form random.

import { streamFor } from './rng'
import { floorDifficulty, type DungeonProfile, type FloorDifficulty } from './tiers'

export type RoomKind = 'entrance' | 'normal' | 'encounter' | 'treasure' | 'special' | 'exit' | 'boss'

export interface FloorRoom {
  readonly id: number
  readonly kind: RoomKind
  /** Grid cell, not pixels: the lab decides how big a cell is drawn. */
  readonly gx: number
  readonly gy: number
  readonly w: number
  readonly h: number
}

export interface FloorLink {
  readonly from: number
  readonly to: number
}

export interface FloorEncounter {
  readonly id: string
  readonly roomId: number
  readonly speciesId: number
  readonly level: number
  /** Points this encounter consumed from the floor budget. */
  readonly weight: number
  readonly isAlpha: boolean
}

export interface FloorChest {
  readonly id: string
  readonly roomId: number
  readonly rarity: 'common' | 'rare' | 'veryRare'
}

export interface FloorPlan {
  readonly floor: number
  readonly difficulty: FloorDifficulty
  readonly width: number
  readonly height: number
  readonly rooms: readonly FloorRoom[]
  readonly links: readonly FloorLink[]
  readonly entranceRoomId: number
  readonly exitRoomId: number
  /** The exit needs a Floor Key; the last floor opens on the Alpha instead. */
  readonly exitLocked: boolean
  readonly encounters: readonly FloorEncounter[]
  readonly chests: readonly FloorChest[]
}

/** Grid the rooms are laid on. Wider floors deeper in, but never unreadable. */
function gridFor(budget: number): { cols: number; rows: number } {
  const cols = Math.max(3, Math.min(6, 3 + Math.floor(budget / 28)))
  const rows = Math.max(3, Math.min(5, 3 + Math.floor(budget / 40)))
  return { cols, rows }
}

/** How many rooms the budget pays for. */
function roomCount(budget: number, cols: number, rows: number): number {
  const wanted = 4 + Math.floor(budget / 9)
  return Math.max(4, Math.min(cols * rows, wanted))
}

/**
 * A path of cells through the grid, from the entrance to the exit. Walking one
 * step right or down at a time keeps the floor readable and always connected;
 * the extra rooms hang off that spine as side rooms.
 */
function spine(cols: number, rows: number, rng: ReturnType<typeof streamFor>): { gx: number; gy: number }[] {
  const cells: { gx: number; gy: number }[] = [{ gx: 0, gy: rng.int(0, rows - 1) }]
  let { gx, gy } = cells[0]
  while (gx < cols - 1) {
    const goDown = gy < rows - 1 && rng.chance(0.4)
    const goUp = !goDown && gy > 0 && rng.chance(0.25)
    if (goDown) gy += 1
    else if (goUp) gy -= 1
    else gx += 1
    cells.push({ gx, gy })
  }
  return cells
}

/**
 * `pool` is the species this dungeon may spawn — the theme's roster, supplied
 * by the caller so the generator never imports a species catalog. The Alpha is
 * drawn from the same pool: APPROVED, no dedicated boss species.
 */
export function generateFloor(profile: DungeonProfile, floor: number, pool: readonly number[] = [0]): FloorPlan {
  const difficulty = floorDifficulty(profile.seed, profile.tier, floor, profile.floors)
  const layout = streamFor(profile.seed, 'layout', profile.theme, floor)
  const { cols, rows } = gridFor(difficulty.budget)
  const path = spine(cols, rows, layout)

  const rooms: FloorRoom[] = []
  const links: FloorLink[] = []
  const used = new Set<string>()
  const key = (gx: number, gy: number) => `${gx}:${gy}`

  for (const cell of path) {
    if (used.has(key(cell.gx, cell.gy))) continue
    used.add(key(cell.gx, cell.gy))
    rooms.push({ id: rooms.length, kind: 'normal', gx: cell.gx, gy: cell.gy, w: layout.int(2, 3), h: layout.int(2, 3) })
    if (rooms.length > 1) links.push({ from: rooms.length - 2, to: rooms.length - 1 })
  }

  // Side rooms: they branch off a room already on the path, so the floor stays connected.
  const wanted = roomCount(difficulty.budget, cols, rows)
  const free: { gx: number; gy: number }[] = []
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) if (!used.has(key(gx, gy))) free.push({ gx, gy })
  }
  for (const cell of layout.shuffle(free)) {
    if (rooms.length >= wanted) break
    const neighbour = rooms.find(room => Math.abs(room.gx - cell.gx) + Math.abs(room.gy - cell.gy) === 1)
    if (!neighbour) continue
    used.add(key(cell.gx, cell.gy))
    rooms.push({ id: rooms.length, kind: 'normal', gx: cell.gx, gy: cell.gy, w: layout.int(2, 3), h: layout.int(2, 3) })
    links.push({ from: neighbour.id, to: rooms.length - 1 })
  }

  const entranceRoomId = 0
  const exitRoomId = rooms.reduce((best, room) => (room.gx > rooms[best].gx ? room.id : best), 0)
  const kinds = new Map<number, RoomKind>([[entranceRoomId, 'entrance'], [exitRoomId, difficulty.isBossFloor ? 'boss' : 'exit']])

  // Encounters: spend the budget on the rooms that are neither the entrance nor the exit.
  const spawn = streamFor(profile.seed, 'encounters', profile.theme, floor)
  const species = pool.length ? pool : [0]
  const encounters: FloorEncounter[] = []
  const candidates = spawn.shuffle(rooms.filter(room => !kinds.has(room.id)).map(room => room.id))
  if (difficulty.isBossFloor) {
    encounters.push({
      id: `f${floor}-alpha`, roomId: exitRoomId, speciesId: spawn.pick(species)!,
      level: difficulty.level, weight: difficulty.budget, isAlpha: true,
    })
  } else {
    let spent = 0
    let index = 0
    while (spent < difficulty.budget && candidates.length > 0) {
      const roomId = candidates[index % candidates.length]
      const level = Math.max(1, difficulty.level + spawn.int(-2, 2))
      const weight = Math.max(4, Math.round(level * 0.4))
      if (spent + weight > difficulty.budget * 1.1) break
      encounters.push({ id: `f${floor}-e${encounters.length}`, roomId, speciesId: spawn.pick(species)!, level, weight, isAlpha: false })
      kinds.set(roomId, 'encounter')
      spent += weight
      index += 1
    }
  }

  // Loot: one guaranteed chest, plus rarer ones the deeper the floor is.
  const lootRng = streamFor(profile.seed, 'chests', profile.theme, floor)
  const chests: FloorChest[] = []
  const chestRooms = lootRng.shuffle(rooms.filter(room => room.id !== entranceRoomId).map(room => room.id))
  const chestCount = 1 + (lootRng.chance(0.3 + difficulty.depth * 0.4) ? 1 : 0)
  for (let i = 0; i < chestCount && i < chestRooms.length; i++) {
    const roll = lootRng.next()
    const rarity = roll < 0.06 + difficulty.depth * 0.08 ? 'veryRare' : roll < 0.35 ? 'rare' : 'common'
    chests.push({ id: `f${floor}-c${i}`, roomId: chestRooms[i], rarity })
    if (!kinds.has(chestRooms[i])) kinds.set(chestRooms[i], 'treasure')
  }

  // A special room appears deeper in: the hook for shrines, puzzles or rest spots.
  if (!difficulty.isBossFloor && lootRng.chance(difficulty.depth * 0.35)) {
    const spare = rooms.find(room => !kinds.has(room.id))
    if (spare) kinds.set(spare.id, 'special')
  }

  return {
    floor,
    difficulty,
    width: cols,
    height: rows,
    rooms: rooms.map(room => ({ ...room, kind: kinds.get(room.id) ?? 'normal' })),
    links,
    entranceRoomId,
    exitRoomId,
    exitLocked: !difficulty.isBossFloor,
    encounters,
    chests,
  }
}

/** The whole dungeon, floor by floor. Cheap enough to regenerate on demand. */
export const generateDungeon = (profile: DungeonProfile, pool: readonly number[] = [0]): FloorPlan[] =>
  Array.from({ length: profile.floors }, (_, i) => generateFloor(profile, i + 1, pool))
