import { isSolidTile, isWaterTile } from './terrain.js'
import { resourceAt } from './resourceLayout.js'
import { WORLD_AREAS } from './areas.js'

/** Test helpers shared by the world's node tests. Not imported by the service. */

/** Resource nodes around Pradera's spawn, each with the open tiles a worker can stand on. */
export function praderaNodesNearSpawn(radius = 20) {
  const { seed, spawn } = WORLD_AREAS.pradera
  const open = (tx, ty) => !isSolidTile(seed, tx, ty) && !isWaterTile(seed, tx, ty) && !resourceAt('pradera', tx, ty)
  const nodes = []
  for (let ty = spawn.ty - radius; ty <= spawn.ty + radius; ty++) {
    for (let tx = spawn.tx - radius; tx <= spawn.tx + radius; tx++) {
      const node = resourceAt('pradera', tx, ty)
      if (!node) continue
      const stands = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ tx: tx + dx, ty: ty + dy })).filter(t => open(t.tx, t.ty))
      if (stands.length >= 2) nodes.push({ node, stands })
    }
  }
  return nodes
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
