import { chunkOf } from './areas.js'
import { PLOT_GROWING_AT } from './worldTuning.js'

/**
 * Farm plots — the first physical Agricultura in the shared world (INTEGRATION-1).
 *
 * WORLD owns a plot's identity, place, stage, timestamps, worker and owner.
 * SKILLS owns what may be planted, by whom, how long it grows and what it gives.
 *
 * Placement (vertical slice): one huerta of four plots in Pradera Brisa, six
 * tiles north-west of the arrival, on open grass with an open ring around it
 * (verified by plots.test.js). SKILLS' hint puts the town huerta beside the
 * exit to Pradera; this is the Pradera side of that exit, and the town itself
 * is hand-drawn art the service does not model. Kind `town` = huerta comunal
 * (the crops of levels 1–20). More plots and fertile soil come later.
 */
export const PLOT_KIND = 'plot'

const plot = (areaId, tx, ty, kind) => Object.freeze({
  id: `${areaId}:${tx}:${ty}:plot`, resourceKind: PLOT_KIND, variantId: 'plot', plotKind: kind,
  areaId, chunkId: chunkOf(tx, ty), tx, ty, zone: 0, biome: 'grassland',
})

export const PLOTS = Object.freeze([
  plot('pradera', -7, -73, 'town'), plot('pradera', -6, -73, 'town'),
  plot('pradera', -7, -72, 'town'), plot('pradera', -6, -72, 'town'),
])

const BY_ID = new Map(PLOTS.map(entry => [entry.id, entry]))

export function plotById(id) {
  return BY_ID.get(id) ?? null
}

export function plotsInChunk(areaId, chunkId) {
  return PLOTS.filter(entry => entry.areaId === areaId && entry.chunkId === chunkId)
}

/** The stage of a planted plot at `now`, from its server timestamps alone. */
export function plotStageAt(data, now) {
  if (!data) return 'empty'
  if (now >= data.readyAt) return 'ready'
  if (now >= data.growingAt) return 'growing'
  return 'planted'
}

/** When the plot's stage next changes by itself, or null. */
export function nextPlotChange(data, now) {
  if (!data) return null
  if (now < data.growingAt) return data.growingAt
  if (now < data.readyAt) return data.readyAt
  return null
}

/**
 * Which farm action a player may request on a plot, or the physical reason
 * not to. Ownership of a planted plot is WORLD's (it planted it); whether the
 * player *can* plant or harvest this crop is SKILLS'.
 */
export function farmActionFor(state, data, playerId) {
  if (state === 'empty') return { action: 'plant' }
  if (data?.ownerId !== playerId) return { reason: 'not-your-plot' }
  if (state === 'ready') return { action: 'harvest' }
  if (state === 'planted' || state === 'growing') return data.tended ? { reason: 'already-tended' } : { action: 'tend' }
  return { reason: state }
}

/** The plot's data right after a completed farm action. */
export function plotAfterWork(action, data, { now, playerId, cropId, growMs }) {
  if (action === 'plant') return { cropId, ownerId: playerId, plantedAt: now, growingAt: now + Math.round(growMs * PLOT_GROWING_AT), readyAt: now + growMs, tended: false }
  if (action === 'tend') return { ...data, tended: true }
  return null
}
