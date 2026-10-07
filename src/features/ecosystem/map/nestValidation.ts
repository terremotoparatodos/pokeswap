// Spatial validation of nest proposals on the real maps (ECO-MAP-1). Pure.
//
// STATIC restrictions only — what the shared map says about a tile, which
// never changes while the layout version stays the same. DYNAMIC occupation
// (players standing anywhere, a worker currently working, a dropped object,
// another wild Pokémon) is not known here and is the integration's job: no
// tile is ever promised to be free of players.

import type { EncounterCatalog, EncounterHabitat, EncounterRarity } from '../encounters/types'
import { ENCOUNTER_RARITIES } from '../encounters/types'
import { inBox, type AreaGeometryView, type Box, type GeometryFlag } from './geometry'

export interface NestProposal {
  readonly id: string
  /** Presence area id (`pradera`, `cueva-inicial`). */
  readonly areaId: string
  /** Catalog zone whose entries the nest draws from. */
  readonly zoneId: string
  /** C1 group name (study label) and its habitats. */
  readonly group: string
  readonly habitats: readonly EncounterHabitat[]
  /** The nest's reference tile (shown in tools; must itself be a valid candidate). */
  readonly anchor: { readonly tx: number; readonly ty: number }
  /** Candidate tiles = every tile of this box that passes the static rules. */
  readonly region: Box
  readonly maxAlive: number
  readonly groupCap: number
  readonly justification: string
}

/** Tiles a candidate may never be: hard, static map facts. */
export const FORBIDDEN_FLAGS: readonly GeometryFlag[] = [
  'blocked', 'unreachable', 'water', 'portal', 'resource', 'work', 'corridor', 'reserved', 'arrivalClearance', 'caveReserved',
]
/** Chebyshev distance kept from arrivals, portals and the cave approach. */
export const PROTECTED_RADIUS = 4
/** Minimum Chebyshev distance between two nest anchors. */
export const MIN_NEST_SPACING = 6

export type NestIssueCode =
  | 'unknown-area' | 'unknown-zone' | 'zone-area-mismatch' | 'unknown-habitat' | 'habitat-without-entries'
  | 'region-outside-area' | 'anchor-outside-region' | 'anchor-invalid' | 'subzone-mismatch'
  | 'too-few-candidates' | 'group-does-not-fit' | 'overlap' | 'too-close' | 'duplicate-id'

export interface NestIssue { readonly code: NestIssueCode; readonly nestId: string; readonly message: string }

export interface NestReport {
  readonly id: string
  readonly candidates: readonly { readonly tx: number; readonly ty: number }[]
  readonly eligible: Readonly<Record<EncounterRarity, readonly string[]>>
  readonly tiersCovered: readonly EncounterRarity[]
  readonly maxGroup: number
  /** Soft notes: habitat-terrain fit, uncovered tiers. Not errors. */
  readonly warnings: readonly string[]
}

const chebyshev = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

/** Why a tile may not host an encounter of this nest (empty = it may). */
export function tileRejections(view: AreaGeometryView, nest: Pick<NestProposal, 'zoneId'>, tx: number, ty: number): string[] {
  if (!view.inWindow(tx, ty)) return ['outside-area']
  const flags = view.flags(tx, ty)
  const out: string[] = FORBIDDEN_FLAGS.filter(f => flags.has(f))
  for (const p of view.area.protected) if (chebyshev(p, { tx, ty }) < PROTECTED_RADIUS) out.push(`near-${p.kind}`)
  const subzone = view.subzoneAt(tx, ty)
  const wanted = nest.zoneId.startsWith('pradera.') && nest.zoneId !== 'pradera.abierta' ? nest.zoneId.slice('pradera.'.length) : null
  if (view.area.areaId === 'pradera' && subzone !== wanted) out.push(wanted ? `outside-subzone-${wanted}` : `inside-subzone-${subzone}`)
  return out
}

export function candidatesOf(view: AreaGeometryView, nest: NestProposal): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = []
  for (let ty = nest.region.y0; ty <= nest.region.y1; ty++) for (let tx = nest.region.x0; tx <= nest.region.x1; tx++) {
    if (tileRejections(view, nest, tx, ty).length === 0) out.push({ tx, ty })
  }
  return out
}

export function validateNests(
  nests: readonly NestProposal[], views: (areaId: string) => AreaGeometryView | null, catalog: EncounterCatalog,
): { issues: NestIssue[]; reports: NestReport[] } {
  const issues: NestIssue[] = []
  const reports: NestReport[] = []
  const add = (code: NestIssueCode, nestId: string, message: string) => issues.push({ code, nestId, message })
  const ids = new Set<string>()
  const candidateSets: { nest: NestProposal; keys: Set<string> }[] = []

  for (const nest of nests) {
    if (ids.has(nest.id)) add('duplicate-id', nest.id, `nest id ${nest.id} used twice`)
    ids.add(nest.id)
    const view = views(nest.areaId)
    if (!view) { add('unknown-area', nest.id, `no geometry for area ${nest.areaId}`); continue }
    const zone = catalog.zones.find(z => z.id === nest.zoneId)
    if (!zone) add('unknown-zone', nest.id, `zone ${nest.zoneId} is not in the catalog`)
    else if (zone.areaId !== nest.areaId) add('zone-area-mismatch', nest.id, `zone ${zone.id} belongs to ${zone.areaId}`)
    const entries = catalog.entries.filter(e => e.zoneId === nest.zoneId && nest.habitats.includes(e.habitat))
    for (const h of nest.habitats) {
      if (!catalog.entries.some(e => e.habitat === h)) add('unknown-habitat', nest.id, `habitat ${h} is not used by the catalog`)
      else if (!entries.some(e => e.habitat === h)) add('habitat-without-entries', nest.id, `zone ${nest.zoneId} has no ${h} entry`)
    }
    const r = nest.region
    if (!view.inWindow(r.x0, r.y0) || !view.inWindow(r.x1, r.y1)) add('region-outside-area', nest.id, `region ${JSON.stringify(r)} leaves the area window`)
    if (!inBox(r, nest.anchor.tx, nest.anchor.ty)) add('anchor-outside-region', nest.id, 'anchor is not inside its region')
    const anchorWhy = tileRejections(view, nest, nest.anchor.tx, nest.anchor.ty)
    if (anchorWhy.length) {
      add('anchor-invalid', nest.id, `anchor (${nest.anchor.tx},${nest.anchor.ty}): ${anchorWhy.join(', ')}`)
      if (anchorWhy.some(w => w.startsWith('outside-subzone') || w.startsWith('inside-subzone'))) add('subzone-mismatch', nest.id, `anchor is not in the zone's ground`)
    }

    const candidates = candidatesOf(view, nest)
    const maxGroup = Math.min(nest.groupCap, entries.reduce((m, e) => Math.max(m, e.group.max), 0))
    if (candidates.length < Math.max(nest.maxAlive, maxGroup)) add('too-few-candidates', nest.id, `${candidates.length} candidate tiles for maxAlive ${nest.maxAlive} and groups up to ${maxGroup}`)
    if (entries.some(e => e.group.min > nest.groupCap)) add('group-does-not-fit', nest.id, `an eligible entry needs a group larger than groupCap ${nest.groupCap}`)
    candidateSets.push({ nest, keys: new Set(candidates.map(t => `${nest.areaId}:${t.tx},${t.ty}`)) })

    const eligible = Object.fromEntries(ENCOUNTER_RARITIES.map(t => [t, entries.filter(e => e.rarity === t).map(e => e.speciesName)])) as Record<EncounterRarity, string[]>
    const tiersCovered = ENCOUNTER_RARITIES.filter(t => eligible[t].length > 0)
    const warnings: string[] = []
    const missing = ENCOUNTER_RARITIES.filter(t => (zone?.rarityShares[t] ?? 0) > 0 && !eligible[t].length)
    if (missing.length) warnings.push(`no candidate for tier(s) ${missing.join(', ')}: attempts landing there end in empty-tier`)
    const commons = entries.filter(e => e.rarity === 'common')
    if (commons.length > 0 && commons.every(e => e.group.min > 1)) warnings.push('every common entry needs a group ≥ 2: when the area has one free slot, the common tier is empty')
    if (nest.habitats.includes('tall-grass') && !candidates.some(t => view.flags(t.tx, t.ty).has('tall'))) warnings.push('hosts tall-grass species but no candidate tile is tall grass')
    if (nest.habitats.includes('grass-near-water') && !candidates.some(t => view.flags(t.tx, t.ty).has('nearWater'))) warnings.push('hosts shore species but no candidate tile is near water')
    reports.push({ id: nest.id, candidates, eligible, tiersCovered, maxGroup, warnings })
  }

  for (let i = 0; i < candidateSets.length; i++) for (let j = i + 1; j < candidateSets.length; j++) {
    const a = candidateSets[i], b = candidateSets[j]
    if (a.nest.areaId !== b.nest.areaId) continue
    if ([...a.keys].some(k => b.keys.has(k))) add('overlap', a.nest.id, `${a.nest.id} and ${b.nest.id} share candidate tiles`)
    if (chebyshev(a.nest.anchor, b.nest.anchor) < MIN_NEST_SPACING) add('too-close', a.nest.id, `${a.nest.id} and ${b.nest.id} anchors are closer than ${MIN_NEST_SPACING}`)
  }
  return { issues, reports }
}
