// @vitest-environment node
// ECO-MAP-1: the geometry snapshot is the real map, the proposals pass the
// static rules on it, and every rule rejects what it exists to reject
// (negative controls on the REAL geometry, not a synthetic grid).

import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs tooling script, no type declarations
import { buildSnapshot } from '../../../../scripts/ecosystem/map-geometry.mjs'
import snapshotRaw from './generated/geometrySnapshot.json?raw'
import nestsRaw from '../../../../docs/design/eco-map-1/nests.json?raw'
import { isReachable, isWalkable, portalAt } from '../../../../services/realtime/src/world/navigation.js'
import { resourceAt } from '../../../../services/realtime/src/world/resourceLayout.js'
import { PLOTS } from '../../../../services/realtime/src/world/plots.js'
import { standableTile, workPlacement } from '../../../../services/realtime/src/world/workPlacement.js'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { validatePopulationConfig } from '../population/config'
import { areaView, type AreaGeometryView } from './geometry'
import { buildNestData, nestValidation, SNAPSHOT } from './nestData'
import { NEST_PROPOSALS } from './nestProposals'
import { MIN_NEST_SPACING, PROTECTED_RADIUS, validateNests, type NestProposal } from './nestValidation'

const unix = (t: string) => t.split('\r\n').join('\n')
const views = (areaId: string) => areaView(SNAPSHOT, areaId)
const pradera = views('pradera')!
const cave = views('cueva-inicial')!
const each = (v: AreaGeometryView, fn: (tx: number, ty: number) => void) => {
  const w = v.area.window
  for (let ty = w.minTy; ty <= w.maxTy; ty++) for (let tx = w.minTx; tx <= w.maxTx; tx++) fn(tx, ty)
}
const find = (v: AreaGeometryView, test: (tx: number, ty: number) => boolean) => {
  let hit: { tx: number; ty: number } | null = null
  each(v, (tx, ty) => { if (!hit && test(tx, ty)) hit = { tx, ty } })
  if (!hit) throw new Error('fixture tile not found on the real map')
  return hit as { tx: number; ty: number }
}

describe('geometry snapshot', () => {
  it('is exactly what the shared world modules produce today', () => {
    expect(unix(snapshotRaw) === buildSnapshot()).toBe(true)
  })

  it('decodes to the same answers as the real helpers, tile by tile', () => {
    for (const v of [pradera, cave]) each(v, (tx, ty) => {
      const f = v.flags(tx, ty)
      const id = v.area.areaId
      expect(f.has('blocked'), `${id} ${tx},${ty}`).toBe(!isWalkable(id, tx, ty))
      expect(f.has('portal'), `${id} ${tx},${ty}`).toBe(portalAt(id, tx, ty) !== null)
      const node = !!resourceAt(id, tx, ty) || PLOTS.some(p => p.areaId === id && p.tx === tx && p.ty === ty)
      expect(f.has('resource'), `${id} ${tx},${ty}`).toBe(node)
    })
  })

  it('records the layout version of each area', () => {
    expect(SNAPSHOT.areas.pradera.layoutVersion).toMatch(/^1\.[0-9a-f]{12}$/)
    expect(SNAPSHOT.areas['cueva-inicial'].layoutVersion).toMatch(/^1\.[0-9a-f]{12}$/)
  })
})

describe('the proposals on the real maps', () => {
  const { issues, reports } = nestValidation()

  it('pass every static rule: no issue', () => {
    expect(issues).toEqual([])
  })

  it('are 5 + 2 + 3, not six per area', () => {
    const count = (zoneId: string) => NEST_PROPOSALS.filter(n => n.zoneId === zoneId).length
    expect([count('pradera.abierta'), count('pradera.bosque'), count('cueva-inicial')]).toEqual([5, 2, 3])
  })

  it('every candidate is walkable, reachable, not a portal, not a node and not a real work position — checked against the helpers directly', () => {
    const workKeys = (areaId: string) => {
      const keys = new Set<string>()
      const standable = standableTile(areaId)
      const nodes = [...PLOTS.filter(p => p.areaId === areaId)]
      each(views(areaId)!, (tx, ty) => { const node = resourceAt(areaId, tx, ty); if (node) nodes.push(node as never) })
      for (const node of nodes) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const trainer = { tx: node.tx + dx, ty: node.ty + dy }
        if (!isWalkable(areaId, trainer.tx, trainer.ty)) continue
        const p = workPlacement(node, trainer, standable)
        if (p) { keys.add(`${p.stand.tx},${p.stand.ty}`); keys.add(`${p.wait.tx},${p.wait.ty}`) }
      }
      return keys
    }
    const work = { pradera: workKeys('pradera'), 'cueva-inicial': workKeys('cueva-inicial') } as Record<string, Set<string>>
    for (const nest of NEST_PROPOSALS) {
      const report = reports.find(r => r.id === nest.id)!
      for (const t of report.candidates) {
        const where = `${nest.id} ${t.tx},${t.ty}`
        expect(isWalkable(nest.areaId, t.tx, t.ty), where).toBe(true)
        expect(isReachable(nest.areaId, t.tx, t.ty), where).toBe(true)
        expect(portalAt(nest.areaId, t.tx, t.ty), where).toBeNull()
        expect(resourceAt(nest.areaId, t.tx, t.ty), where).toBeNull()
        expect(work[nest.areaId].has(`${t.tx},${t.ty}`), where).toBe(false)
      }
    }
  })

  it('keep their distance from arrivals, portals and the cave approach; do not overlap', () => {
    const seen = new Map<string, string>()
    for (const nest of NEST_PROPOSALS) {
      const view = views(nest.areaId)!
      for (const t of reports.find(r => r.id === nest.id)!.candidates) {
        for (const p of view.area.protected) expect(Math.max(Math.abs(p.tx - t.tx), Math.abs(p.ty - t.ty)), `${nest.id} vs ${p.kind}`).toBeGreaterThanOrEqual(PROTECTED_RADIUS)
        const key = `${nest.areaId}:${t.tx},${t.ty}`
        expect(seen.get(key), key).toBeUndefined()
        seen.set(key, nest.id)
      }
    }
  })

  it('can host their groups: candidates ≥ max(maxAlive, largest group)', () => {
    for (const nest of NEST_PROPOSALS) {
      const r = reports.find(x => x.id === nest.id)!
      expect(r.candidates.length, nest.id).toBeGreaterThanOrEqual(Math.max(nest.maxAlive, r.maxGroup))
    }
  })

  it('report the known, accepted warnings — nothing else', () => {
    const warned = Object.fromEntries(reports.filter(r => r.warnings.length).map(r => [r.id, r.warnings.length]))
    expect(warned).toEqual({ 'pradera-orilla-este': 1, 'bosque-sotobosque-sureste': 1, 'cueva-techo-norte': 2, 'cueva-roca-este': 1 })
  })

  it('are accepted by the engine as nest configuration', () => {
    for (const zoneId of ['pradera.abierta', 'pradera.bosque', 'cueva-inicial']) {
      const nests = NEST_PROPOSALS.filter(n => n.zoneId === zoneId)
      const report = (id: string) => reports.find(r => r.id === id)!
      const config = {
        namespace: 'map-test', areas: [{
          areaId: nests[0].areaId, maxAlive: 6, idle: { dormantAfterMs: 300_000, staggerMinMs: 5_000, staggerMaxMs: 15_000 },
          nests: nests.map(n => ({ id: n.id, zoneId: n.zoneId, habitats: n.habitats, tiles: report(n.id).candidates, maxAlive: n.maxAlive, groupCap: n.groupCap, respawn: { policy: 'per-group' as const, delayMs: 75_000, jitter: 0.2, retryMs: 15_000 } })),
        }],
      }
      expect(validatePopulationConfig(config, ECO_1_ENCOUNTER_CATALOG), zoneId).toEqual([])
    }
  })

  it('nests.json is exactly what the proposals and the snapshot derive', () => {
    expect(unix(nestsRaw) === JSON.stringify(buildNestData(), null, 1) + '\n').toBe(true)
  })
})

describe('negative controls on the real geometry', () => {
  const base = NEST_PROPOSALS.find(n => n.id === 'pradera-pastizal-oeste')!
  const caveBase = NEST_PROPOSALS.find(n => n.id === 'cueva-techo-norte')!
  const only = (nest: NestProposal) => validateNests([nest], views, ECO_1_ENCOUNTER_CATALOG)
  const codesOf = (nest: NestProposal) => only(nest).issues.map(i => i.code)
  const why = (nest: NestProposal) => only(nest).issues.map(i => i.message).join(' | ')
  const at = (nest: NestProposal, t: { tx: number; ty: number }, region = { x0: t.tx, y0: t.ty, x1: t.tx, y1: t.ty }): NestProposal => ({ ...nest, anchor: t, region, maxAlive: 1, groupCap: 1 })

  it('a nest in a wall', () => {
    const wall = find(cave, (tx, ty) => cave.flags(tx, ty).has('blocked'))
    expect(why(at(caveBase, wall))).toMatch(/anchor .*blocked/)
  })

  it('a nest on a portal (cave exit, cave mouth)', () => {
    expect(why(at(caveBase, { tx: 10, ty: 13 }))).toMatch(/portal.*near-portal→pradera|near-portal→pradera/)
    expect(why(at(base, { tx: -25, ty: -74 }))).toMatch(/anchor \(-25,-74\): .*portal/)
  })

  it('a nest outside the area', () => {
    expect(codesOf(at(caveBase, { tx: 30, ty: 30 }))).toEqual(expect.arrayContaining(['region-outside-area', 'anchor-invalid']))
  })

  it('an unreachable nest (a real fenced pocket of Pradera)', () => {
    const pocket = find(pradera, (tx, ty) => pradera.flags(tx, ty).has('unreachable'))
    expect(why(at(base, pocket))).toMatch(/unreachable/)
  })

  it('a nest on a resource node, and on a real work position', () => {
    const tree = find(pradera, (tx, ty) => pradera.flags(tx, ty).has('resource') && pradera.subzoneAt(tx, ty) === 'bosque')
    const bosque = NEST_PROPOSALS.find(n => n.id === 'bosque-claro-suroeste')!
    expect(why(at(bosque, tree))).toMatch(/resource/)
    const workOnly = find(pradera, (tx, ty) => pradera.flags(tx, ty).has('work') && !pradera.flags(tx, ty).has('blocked') && pradera.subzoneAt(tx, ty) === 'bosque' && !pradera.flags(tx, ty).has('corridor'))
    expect(why(at(bosque, workOnly))).toMatch(/anchor \(-?\d+,-?\d+\): work(,|$| )/)
  })

  it('overlap, spacing, capacity and subzone', () => {
    const twin = { ...base, id: 'twin', anchor: { tx: base.anchor.tx + 1, ty: base.anchor.ty } }
    const both = validateNests([base, twin], views, ECO_1_ENCOUNTER_CATALOG).issues.map(i => i.code)
    expect(both).toEqual(expect.arrayContaining(['overlap', 'too-close']))
    expect(MIN_NEST_SPACING).toBe(6)
    expect(codesOf({ ...base, region: { x0: base.anchor.tx, y0: base.anchor.ty, x1: base.anchor.tx, y1: base.anchor.ty } })).toContain('too-few-candidates')
    const inForest = { ...base, anchor: { tx: -16, ty: -44 }, region: { x0: -17, y0: -44, x1: -15, y1: -43 } }
    expect(codesOf(inForest)).toEqual(expect.arrayContaining(['anchor-invalid', 'subzone-mismatch']))
  })

  it('a pool that does not fit its nest', () => {
    expect(codesOf({ ...caveBase, groupCap: 1 })).toContain('group-does-not-fit')
    expect(codesOf({ ...caveBase, habitats: ['open-grass'] })).toContain('habitat-without-entries')
  })
})
