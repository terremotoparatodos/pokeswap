// ECO-MAP-1 · the simulator's "real map (proposal)" mode. Builds a scenario
// from the REAL geometry snapshot and the proposed nests (map/). The engine
// and catalog are the real ones; the nests are a development proposal, not
// integrated anywhere.

import { areaView, type AreaGeometryView } from '../map/geometry'
import { nestValidation, SNAPSHOT } from '../map/nestData'
import { NEST_PROPOSALS } from '../map/nestProposals'
import { tileRejections, type NestReport } from '../map/nestValidation'
import { capacityReport } from '../population/capacity'
import type { Tile } from '../population/types'
import { proposedAreaConfig } from '../map/capacityProposal'
import type { Bounds, PreviewZoneId, Scenario, SimParams } from './scenarios'

/** Display char of each tile kind, most important fact first. */
export const TILE_KIND = Object.freeze({
  protected: 'P', portal: 'p', blocked: '#', water: '~', resource: 'R', work: 'w', corridor: '=', reserved: 'r', unreachable: 'u', tall: '"', floor: '.',
})

const AREA_OF: Record<PreviewZoneId, string> = { 'pradera.abierta': 'pradera', 'pradera.bosque': 'pradera', 'cueva-inicial': 'cueva-inicial' }

function boundsOf(zoneId: PreviewZoneId, view: AreaGeometryView): Bounds {
  const w = view.area.window
  if (zoneId !== 'pradera.bosque') return { ...w }
  const box = view.area.subzones.find(z => z.id === 'bosque')!.box
  return { minTx: Math.max(w.minTx, box.x0 - 3), minTy: Math.max(w.minTy, box.y0 - 3), maxTx: Math.min(w.maxTx, box.x1 + 3), maxTy: Math.min(w.maxTy, box.y1 + 3) }
}

function kindAt(view: AreaGeometryView, tx: number, ty: number): string {
  if (view.area.protected.some(p => p.tx === tx && p.ty === ty)) return TILE_KIND.protected
  const f = view.flags(tx, ty)
  if (f.has('portal')) return TILE_KIND.portal
  if (f.has('blocked')) return f.has('resource') ? TILE_KIND.resource : TILE_KIND.blocked
  if (f.has('water')) return TILE_KIND.water
  if (f.has('resource')) return TILE_KIND.resource
  if (f.has('unreachable')) return TILE_KIND.unreachable
  if (f.has('work')) return TILE_KIND.work
  if (f.has('corridor')) return TILE_KIND.corridor
  if (f.has('reserved') || f.has('arrivalClearance') || f.has('caveReserved')) return TILE_KIND.reserved
  return f.has('tall') ? TILE_KIND.tall : TILE_KIND.floor
}

/** How much of the forest the strict rule leaves (computed from the real map, never hand-typed). */
export function forestConstraint(view: AreaGeometryView): string {
  const box = view.area.subzones.find(z => z.id === 'bosque')!.box
  let walkable = 0, free = 0
  for (let ty = box.y0; ty <= box.y1; ty++) for (let tx = box.x0; tx <= box.x1; tx++) {
    if (!view.flags(tx, ty).has('blocked')) walkable++
    if (tileRejections(view, { zoneId: 'pradera.bosque' }, tx, ty).length === 0) free++
  }
  return `restricción: ${walkable} casillas transitables en el bosque; sólo ${free} quedan libres de nodos, pasillos y posiciones reales de trabajo`
}

export const realNests = (zoneId: PreviewZoneId) => NEST_PROPOSALS.filter(n => n.zoneId === zoneId)

/** Proposal + derived report for each nest of a zone (for the inspector). */
export function realNestDetails(zoneId: PreviewZoneId) {
  const { reports } = nestValidation()
  // Every nest of the AREA: in the whole-Pradera view the forest nests are visible and inspectable too.
  return NEST_PROPOSALS.filter(n => n.areaId === AREA_OF[zoneId]).map(nest => ({ nest, report: reports.find(r => r.id === nest.id) as NestReport }))
}

/**
 * ECO-CAPACITY-1: the real-map scenario is the whole presence AREA (Pradera:
 * abierta + bosque nests with their population zones; cave: its three nests),
 * with the proposed capacity. The selected zone only chooses what is drawn.
 */
export function buildRealScenario(zoneId: PreviewZoneId, params: SimParams, seed: number): Scenario {
  const view = areaView(SNAPSHOT, AREA_OF[zoneId])!
  const { issues, reports } = nestValidation()
  const bounds = boundsOf(zoneId, view)
  const area = proposedAreaConfig(view.area.areaId,
    { policy: params.policy, delayMs: params.delayMs, jitter: params.jitter, retryMs: params.retryMs },
    { dormantAfterMs: params.dormantAfterMs, staggerMinMs: params.staggerMinMs, staggerMaxMs: params.staggerMaxMs })
  const areaNests = new Set(area.nests.map(n => n.id))
  // The engine simulates the whole area window; only the drawing is cropped to `bounds`.
  const simBounds = { ...view.area.window }
  const blocked: Tile[] = []
  for (let ty = simBounds.minTy; ty <= simBounds.maxTy; ty++) for (let tx = simBounds.minTx; tx <= simBounds.maxTx; tx++) {
    const f = view.flags(tx, ty)
    if (['blocked', 'unreachable', 'water', 'portal', 'resource'].some(x => f.has(x as never))) blocked.push({ tx, ty })
  }
  const kinds: string[] = []
  for (let ty = bounds.minTy; ty <= bounds.maxTy; ty++) {
    let row = ''
    for (let tx = bounds.minTx; tx <= bounds.maxTx; tx++) row += kindAt(view, tx, ty)
    kinds.push(row)
  }
  const capacity = capacityReport(area)
  const notes = [
    `PROPUESTA DE DESARROLLO · mapa real ${view.area.areaId} (layout ${view.area.layoutVersion}) · nidos no integrados al juego`,
    `capacidad provisional (ECO-CAPACITY-1): área ${area.maxAlive}; ${(area.zones ?? []).map(z => `${z.id} ${z.maxAlive ?? 'sin máximo propio'}`).join(', ')} — máximos, no reservas`,
    ...capacity.notes.map(n => `capacidad: ${n}`),
    ...issues.filter(i => areaNests.has(i.nestId)).map(i => `ERROR ${i.nestId}: ${i.message}`),
    ...realNests(zoneId).flatMap(n => reports.find(r => r.id === n.id)!.warnings.map(w => `aviso ${n.id}: ${w}`)),
    ...(zoneId === 'pradera.bosque' ? [forestConstraint(view)] : []),
  ]
  return { zoneId, layout: 'real-map', bounds, simBounds, blocked, kinds, notes, config: { namespace: `preview-${seed}`, areas: [area] } }
}
