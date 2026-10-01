import { isWaterTile } from './terrain.js'
import { isSolidAtArea } from './resourceZones.js'
import { resourceAt } from './resourceLayout.js'
import { WORLD_AREAS } from './areas.js'
import { isWalkable, nextHop, portalAt, portalTo } from './navigation.js'

/** Test helpers shared by the world's node tests. Not imported by the service. */

/** Resource nodes around Pradera's spawn, each with the open tiles a worker can stand on. */
export function praderaNodesNearSpawn(radius = 20) {
  const { seed, spawn } = WORLD_AREAS.pradera
  const open = (tx, ty) => !isSolidAtArea('pradera', seed, tx, ty) && !isWaterTile(seed, tx, ty) && !resourceAt('pradera', tx, ty)
  const nodes = []
  for (let ty = spawn.ty - radius; ty <= spawn.ty + radius; ty++) {
    for (let tx = spawn.tx - radius; tx <= spawn.tx + radius; tx++) {
      const node = resourceAt('pradera', tx, ty)
      if (!node) continue
      const stands = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ tx: tx + dx, ty: ty + dy })).filter(t => open(t.tx, t.ty))
      if (stands.length >= 2) nodes.push({ node, stands })
    }
  }
  // Trees first (fixtures call the first one TREE), each kind in scan order.
  return [...nodes.filter(entry => entry.node.resourceKind === 'tree'), ...nodes.filter(entry => entry.node.resourceKind !== 'tree')]
}

export function manualClock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: ms => { now += ms }, set: value => { now = value } }
}

export function fakeClient(id) {
  const messages = []
  return { sessionId: id, userData: undefined, send: (type, payload) => messages.push({ type, payload }), messages, leave() {} }
}

export const lastMessage = (client, type) => [...client.messages].reverse().find(entry => entry.type === type)?.payload
export const messagesOf = (client, type) => client.messages.filter(entry => entry.type === type).map(entry => entry.payload)

/** Lets every pending promise continuation run (ownership and SKILLS are async). */
export const settle = () => new Promise(resolve => setImmediate(resolve))

/**
 * The server's PRIVATE duration of a running action (SKILLS PROB-2): attempts ×
 * tick from the secret draw. Tests read it from the authority; no client ever
 * receives it.
 */
export function privateDuration(authority, actionId) {
  const action = authority.actions.get(actionId)
  if (!action) throw new Error(`no running action ${actionId}`)
  // The sequence's current unit (YIELD-2): unit 0 starts with the sequence.
  return action.endsAt - (action.unitStartedAt ?? action.startedAt)
}

/** A random source that returns `values` in order, then `rest` forever (tests only). */
export function scriptedRandom(values = [], rest = 0.5) {
  const queue = [...values]
  return () => (queue.length ? queue.shift() : rest)
}

/** Every key, at any depth, of a message payload. */
export function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, out)
  else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) { out.add(key); keysDeep(inner, out) }
  return out
}

/** Every number, at any depth, of a message payload. */
export function numbersDeep(value, out = []) {
  if (Array.isArray(value)) for (const item of value) numbersDeep(item, out)
  else if (value && typeof value === 'object') for (const inner of Object.values(value)) numbersDeep(inner, out)
  else if (typeof value === 'number') out.push(value)
  return out
}

const ROUTE_STEPS = Object.freeze([['right', 1, 0], ['left', -1, 0], ['down', 0, 1], ['up', 0, -1]])

/**
 * CAVES-4: the shortest walk between two tiles of a shared area over the
 * shared collision (`navigation.js`), never crossing a portal other than the
 * goal. Directions in order, or null when the goal is out of reach within
 * `radius` tiles of the start.
 */
export function routeBetween(areaId, from, to, radius = 160) {
  const key = (tx, ty) => `${tx},${ty}`
  const previous = new Map([[key(from.tx, from.ty), null]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]
    if (at.tx === to.tx && at.ty === to.ty) {
      const directions = []
      for (let k = key(at.tx, at.ty); previous.get(k);) { const [direction, back] = previous.get(k); directions.unshift(direction); k = back }
      return directions
    }
    for (const [direction, dx, dy] of ROUTE_STEPS) {
      const tx = at.tx + dx, ty = at.ty + dy
      if (previous.has(key(tx, ty)) || Math.abs(tx - from.tx) > radius || Math.abs(ty - from.ty) > radius) continue
      if (!isWalkable(areaId, tx, ty)) continue
      if (portalAt(areaId, tx, ty) !== null && !(tx === to.tx && ty === to.ty)) continue
      previous.set(key(tx, ty), [direction, key(at.tx, at.ty)])
      queue.push({ tx, ty })
    }
  }
  return null
}

/**
 * Test setup: takes a player to `to` through the real portals. At each hop it
 * stands the actor on the portal with a server-made move (`placeActor`) and
 * then asks for the area like a client would, so every crossing still goes
 * through the service's own rules.
 */
export function crossTo(room, client, actor, to) {
  for (let hops = 0; actor.areaId !== to; hops++) {
    if (hops > 3) throw new Error(`could not cross from ${actor.areaId} to ${to}`)
    const next = nextHop(actor.areaId, to)
    const tile = next ? portalTo(actor.areaId, next) : null
    if (!tile) throw new Error(`no portal from ${actor.areaId} towards ${to}`)
    room.placeActor(actor, { tx: tile.tx, ty: tile.ty, dir: actor.dir })
    room.changeArea(client, { areaId: next })
    if (actor.areaId !== next) throw new Error(`the crossing from ${tile.areaId} to ${next} was refused`)
  }
  return actor
}

/**
 * The first of `prefer` whose step from `at` lands on a walkable, non-portal
 * tile of the area (CAVES-4: tests that "walk away" must not walk into a tree).
 */
export function openDirection(areaId, at, prefer = ['up', 'down', 'left', 'right']) {
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
  return prefer.find(direction => {
    const [dx, dy] = delta[direction]
    return isWalkable(areaId, at.tx + dx, at.ty + dy) && portalAt(areaId, at.tx + dx, at.ty + dy) === null
  }) ?? null
}
