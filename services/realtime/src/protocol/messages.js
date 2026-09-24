/** Shared wire contract. Keep this module dependency-free so Vite may consume it. */
export const AREA = Object.freeze({ TOWN: 'ciudad-corazon', WILD: 'pradera' })
export const AREAS = new Set(Object.values(AREA))
export const DIRECTIONS = new Set(['up', 'down', 'left', 'right'])
export const MESSAGE = Object.freeze({
  READY: 'presence:ready', MOVE: 'move', AREA: 'area', OBSERVE: 'observe',
  SNAPSHOT: 'presence:snapshot', SELF: 'presence:self', DELTA: 'presence:delta', BATCH: 'presence:batch', ERROR: 'presence:error',
  // Community Playtest 0.1 — area chat. `CHAT` is what a client sends; the
  // other two are what it receives on joining an area and on every new line.
  CHAT: 'chat', CHAT_HISTORY: 'chat:history', CHAT_LINE: 'chat:line',
})

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

/**
 * Presence protocol a client may declare in its join options. From 2 on, a
 * viewer that already holds an actor's identity receives its moves as `step`
 * deltas carrying only what a step changes. Older clients keep receiving full
 * `upsert` actors, so the server can deploy ahead of the frontend.
 */
export const COMPACT_STEP_PROTOCOL = 2

/** The fields a single move changes. Identity (username, character, companion, area) is not repeated. */
export function stepActor(actor) {
  return { id: actor.id, tx: actor.tx, ty: actor.ty, dir: actor.dir, speed: actor.speed, moveSequence: actor.moveSequence }
}

/**
 * Earlier steps of the same actor kept when several land in one 50 ms batch
 * window. Only the latest state used to survive the window, so two moves
 * inside it reached viewers as a two-tile jump. The final step keeps its
 * shape; `via` lists the steps before it, oldest first, without the id.
 * Viewers that do not know the field still get the final step, as before.
 * Bounded: past this many, the oldest are dropped and the viewer resyncs.
 */
export const MAX_VIA_STEPS = 8

export function stackStep(queued, delta) {
  const { id: _id, ...earlier } = queued.actor
  const via = [...(queued.via ?? []), earlier].slice(-MAX_VIA_STEPS)
  return { ...delta, via }
}

export function publicActor(actor) {
  return {
    id: actor.id, areaId: actor.areaId, tx: actor.tx, ty: actor.ty,
    username: actor.username, characterId: actor.characterId, companionId: actor.companionId,
    dir: actor.dir, speed: actor.speed, moveSequence: actor.moveSequence,
  }
}
