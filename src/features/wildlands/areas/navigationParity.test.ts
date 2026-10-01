// CAVES-4 on the browser side: the player collides, crosses and lands exactly
// where the presence service says, in every shared area, so a legitimate
// client is never refused (and the service's refusals only catch forgeries).

import { describe, expect, it } from 'vitest'
import { ARRIVALS, arrivalFor } from '../../../../services/realtime/src/protocol/arrival.js'
import { AREA_BOUNDS, PORTALS, isReachable, isWalkable, portalAt } from '../../../../services/realtime/src/world/navigation.js'
import { portalAt as clientPortalAt } from '../engine/area'
import { isPresenceAreaId } from '../multiplayer/domain/presence'
import { Atlas } from './atlas'

const atlas = new Atlas()
const SHARED = ['ciudad-corazon', 'pradera', 'cueva-inicial'] as const

describe('navigation parity with the presence service (CAVES-4)', () => {
  it('Pradera collides like the service around everything authored, and at its hard edge', () => {
    const pradera = atlas.get('pradera')
    for (let ty = -110; ty < -30; ty++) {
      for (let tx = -50; tx < 30; tx++) expect(pradera.isSolid(tx, ty), `${tx},${ty}`).toBe(!isWalkable('pradera', tx, ty))
    }
    const b = AREA_BOUNDS.pradera
    for (const ty of [-3, 0, 7]) {
      for (const tx of [b.maxTx - 1, b.maxTx, b.maxTx + 1, b.minTx - 1, b.minTx]) expect(pradera.isSolid(tx, ty), `${tx},${ty}`).toBe(!isWalkable('pradera', tx, ty))
    }
    expect(pradera.isSolid(b.maxTx + 1, 0)).toBe(true)
  })

  it('the local-only worlds keep no edge: the hard edge belongs to shared areas', () => {
    const bosque = atlas.get('bosque')
    const b = AREA_BOUNDS.pradera
    let open = 0
    for (let ty = 0; ty < 30; ty++) if (!bosque.isSolid(b.maxTx + 5, ty)) open++
    expect(open).toBeGreaterThan(0)
  })

  it('Ciudad and the cave judge reachability like the service (its resync repairs exactly what the safe point flags)', () => {
    for (const areaId of ['ciudad-corazon', 'cueva-inicial'] as const) {
      const area = atlas.get(areaId)
      for (let ty = -2; ty < 53; ty++) {
        for (let tx = -2; tx < 66; tx++) {
          const client = !area.isSolid(tx, ty) && (area.isReachable?.(tx, ty) ?? true)
          expect(client, `${areaId} ${tx},${ty}`).toBe(isReachable(areaId, tx, ty))
        }
      }
    }
  })

  it('every portal of every shared area is the same tile, to the same area, on both sides', () => {
    for (const areaId of SHARED) {
      const area = atlas.get(areaId)
      type Row = { areaId: string; tx: number; ty: number; to: string }
      const client: Row[] = area.portals.flatMap(p => p.tiles.map(t => ({ areaId, tx: t.tx, ty: t.ty, to: p.to })))
      const service: Row[] = PORTALS.filter(p => p.areaId === areaId).map(p => ({ ...p }))
      const order = (list: Row[]) => [...list].sort((x, y) => x.tx - y.tx || x.ty - y.ty)
      expect(order(client), areaId).toEqual(order(service))
      for (const p of service) expect(clientPortalAt(area, p.tx, p.ty)?.to).toBe(portalAt(areaId, p.tx, p.ty))
    }
  })

  it('every crossing the service accepts lands where the client lands', () => {
    for (const p of PORTALS.filter(portal => isPresenceAreaId(portal.to))) {
      const landing = atlas.get(p.to).arrival(p.areaId)
      expect({ tx: landing.tx, ty: landing.ty, dir: landing.dir }, `${p.areaId} → ${p.to}`).toEqual({ ...arrivalFor(p.to, p.areaId) })
    }
    // First join lands on the town spawn on both sides.
    expect({ ...atlas.get('ciudad-corazon').arrival(null) }).toEqual({ ...ARRIVALS['ciudad-corazon'] })
  })
})
