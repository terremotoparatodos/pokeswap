import { hash2 } from './terrain.js'

/**
 * Shared wandering (WORLD-1D).
 *
 * Wanderers used to take `Math.random()` steps in every browser, so two
 * players never saw an NPC or a wild Pokémon in the same place. A patrol is the
 * same wandering, rolled once from a stable key: a loop of beats that leaves
 * home, strolls within a leash and walks back the way it came. Where an actor
 * stands is then a pure function of (key, home, terrain, server time): every
 * client samples the same loop at the same server instant and nothing is sent
 * per step. The server can sample it too.
 *
 * The rules mirror `wander()` in the browser's actors.ts: think every 0.6–3 s,
 * 35 % of thoughts only turn, drift back home past 4 tiles, never step onto a
 * tile the actor cannot stand on.
 */

export const PATROL_LEASH = 4
const OUTBOUND_BEATS = 40
const DIRS = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]]
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

/** Integer hash of a string key (FNV-1a), for seeding. */
export function keySeed(key) {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  return h | 0
}

/**
 * @param {{ key: string, home: { tx: number, ty: number }, walkable: (tx: number, ty: number) => boolean, speed: number, leash?: number }} options
 */
export function buildPatrol({ key, home, walkable, speed, leash = PATROL_LEASH }) {
  const seed = keySeed(key)
  let n = 0
  const random = () => hash2(n++, 7, seed)
  const beats = []
  let t = 0
  let x = home.tx
  let y = home.ty
  let dir = DIRS[Math.floor(random() * 4)][0]
  const taken = []
  const push = (fromTx, fromTy, moving, dwell) => {
    beats.push({ t, fromTx, fromTy, tx: x, ty: y, dir, moving })
    t += dwell
  }
  for (let i = 0; i < OUTBOUND_BEATS; i++) {
    const dwell = (0.6 + random() * 2.4) * 1000
    if (random() < 0.35) { dir = DIRS[Math.floor(random() * 4)][0]; push(x, y, false, dwell); continue }
    let [name, dx, dy] = DIRS[Math.floor(random() * 4)]
    const offX = x - home.tx
    const offY = y - home.ty
    if (Math.abs(offX) > leash || Math.abs(offY) > leash) {
      ;[name, dx, dy] = Math.abs(offX) > Math.abs(offY) ? (offX > 0 ? DIRS[2] : DIRS[3]) : offY > 0 ? DIRS[0] : DIRS[1]
    }
    dir = name
    if (!walkable(x + dx, y + dy)) { push(x, y, false, dwell); continue }
    const fromTx = x
    const fromTy = y
    x += dx; y += dy
    taken.push(name)
    push(fromTx, fromTy, true, Math.max(dwell, 1000 / speed))
  }
  // Walk back the same tiles, so the loop closes at home without a jump.
  for (let i = taken.length - 1; i >= 0; i--) {
    dir = OPPOSITE[taken[i]]
    const [, dx, dy] = DIRS.find(([name]) => name === dir)
    const fromTx = x
    const fromTy = y
    x += dx; y += dy
    push(fromTx, fromTy, true, Math.max((0.6 + random() * 0.8) * 1000, 1000 / speed))
  }
  if (beats.length === 0) push(x, y, false, 1000)
  return { key, speed, beats, periodMs: t, phaseMs: Math.floor(hash2(1, 2, seed) * t) }
}

/**
 * Where the actor is at server time `nowMs`: the tile it comes from, the tile
 * it goes to, the progress between them (0..1) and its facing.
 */
export function samplePatrol(patrol, nowMs) {
  const { beats, periodMs } = patrol
  const t = (((nowMs + patrol.phaseMs) % periodMs) + periodMs) % periodMs
  let lo = 0
  let hi = beats.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (beats[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const beat = beats[lo]
  const progress = beat.moving ? Math.min(1, ((t - beat.t) * patrol.speed) / 1000) : 1
  return { fromTx: beat.fromTx, fromTy: beat.fromTy, tx: beat.tx, ty: beat.ty, dir: beat.dir, progress }
}
