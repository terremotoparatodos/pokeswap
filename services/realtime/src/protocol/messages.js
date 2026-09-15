/** Shared wire contract. Keep this module dependency-free so Vite may consume it. */
export const AREA = Object.freeze({ TOWN: 'ciudad-corazon', WILD: 'pradera' })
export const AREAS = new Set(Object.values(AREA))
export const DIRECTIONS = new Set(['up', 'down', 'left', 'right'])
export const MESSAGE = Object.freeze({ READY: 'presence:ready', MOVE: 'move', AREA: 'area', OBSERVE: 'observe', SNAPSHOT: 'presence:snapshot', SELF: 'presence:self', DELTA: 'presence:delta', ERROR: 'presence:error' })

export function moveIntent(value) {
  if (!value || typeof value !== 'object' || !DIRECTIONS.has(value.direction)) return null
  // During a rolling deploy, already-loaded clients omit this display hint.
  // They remain bounded and render as walking rather than being disconnected.
  if (value.running !== undefined && typeof value.running !== 'boolean') return null
  if (value.sequence !== undefined && (!Number.isInteger(value.sequence) || value.sequence < 1)) return null
  return { direction: value.direction, running: value.running === true, sequence: value.sequence ?? null }
}

export function areaIntent(value) {
  if (!value || typeof value !== 'object' || !AREAS.has(value.areaId)) return null
  return { areaId: value.areaId }
}

export function observeIntent(value) {
  if (!value || typeof value !== 'object' || !AREAS.has(value.areaId) || !Number.isInteger(value.tx) || !Number.isInteger(value.ty)) return null
  return { areaId: value.areaId, tx: value.tx, ty: value.ty }
}

export function publicActor(actor) {
  return {
    id: actor.id, areaId: actor.areaId, tx: actor.tx, ty: actor.ty,
    username: actor.username, characterId: actor.characterId, companionId: actor.companionId,
    dir: actor.dir, speed: actor.speed, moveSequence: actor.moveSequence,
  }
}
