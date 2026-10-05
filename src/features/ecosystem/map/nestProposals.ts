// ECO-MAP-1 — nest proposals on the REAL maps (Pradera layout 1.7eb512c66092,
// cueva-inicial layout 1.54820710979b; see generated/geometrySnapshot.json).
//
// PROPOSAL for review, not approved. Pools follow the C1 study groups of
// ECO-BALANCE-1 (working alternative only). No species, weights or excluded
// categories change. Candidate tiles are DERIVED from each region by
// `nestValidation.ts` against the real geometry; nothing is hand-copied.
//
// Counts differ from the synthetic six-nest grid on purpose:
//   Pradera abierta 5 — open grass is plentiful; water exists only on the east shore, so one shore nest.
//   Bosque 2 — almost every walkable forest tile is a real work position of a tree node; only two
//              small clearings pass the strict rule (see ECO_MAP_1_REPORT.md §3.2).
//   Cueva 3 — 157 floor tiles, arrival and exit at the south: three nests away from them.

import type { NestProposal } from './nestValidation'

const PASTIZAL = ['open-grass', 'tall-grass'] as const
const ORILLA = ['open-grass', 'grass-near-water'] as const
const SOTOBOSQUE = ['undergrowth', 'branches', 'foliage'] as const
const CLARO = ['damp-clearing', 'clearing', 'conifers'] as const

export const NEST_PROPOSALS_VERSION = 'eco-map-1/proposal/2026-10-05'

export const NEST_PROPOSALS: readonly NestProposal[] = [
  // ── Pradera abierta (area `pradera`, outside the forest and quarry zones) ──
  {
    id: 'pradera-pastizal-oeste', areaId: 'pradera', zoneId: 'pradera.abierta', group: 'pastizal', habitats: [...PASTIZAL],
    anchor: { tx: -34, ty: -83 }, region: { x0: -38, y0: -86, x1: -30, y1: -80 }, maxAlive: 3, groupCap: 3,
    justification: 'Large tall-grass field west of the arrival, behind the cave: grass and tall grass mixed, nine tiles or more from the cave mouth.',
  },
  {
    id: 'pradera-pastizal-norte', areaId: 'pradera', zoneId: 'pradera.abierta', group: 'pastizal', habitats: [...PASTIZAL],
    anchor: { tx: -16, ty: -97 }, region: { x0: -20, y0: -99, x1: -12, y1: -94 }, maxAlive: 3, groupCap: 3,
    justification: 'Northern tall-grass band beyond the mineral reserve: a destination north of the arrival, clear of the reserve.',
  },
  {
    id: 'pradera-pastizal-noreste', areaId: 'pradera', zoneId: 'pradera.abierta', group: 'pastizal', habitats: [...PASTIZAL],
    anchor: { tx: 10, ty: -90 }, region: { x0: 6, y0: -93, x1: 14, y1: -87 }, maxAlive: 3, groupCap: 3,
    justification: 'Tall-grass meadow north of the quarry and east of the reserve; separate from the quarry work area.',
  },
  {
    id: 'pradera-orilla-este', areaId: 'pradera', zoneId: 'pradera.abierta', group: 'orilla', habitats: [...ORILLA],
    anchor: { tx: 27, ty: -84 }, region: { x0: 24, y0: -88, x1: 29, y1: -80 }, maxAlive: 3, groupCap: 3,
    justification: 'The only water near the arrival is the eastern shore: grass within three tiles of it hosts the shore pool (Bidoof).',
  },
  {
    id: 'pradera-pastizal-este', areaId: 'pradera', zoneId: 'pradera.abierta', group: 'pastizal', habitats: [...PASTIZAL],
    anchor: { tx: 18, ty: -55 }, region: { x0: 15, y0: -58, x1: 22, y1: -52 }, maxAlive: 3, groupCap: 3,
    justification: 'Tall-grass slope east of the forest and south of the quarry: spreads players away from the arrival to the south-east.',
  },

  // ── Bosque (subzone `bosque`; strict rule leaves two clearings) ───────────
  {
    id: 'bosque-claro-suroeste', areaId: 'pradera', zoneId: 'pradera.bosque', group: 'claro', habitats: [...CLARO],
    anchor: { tx: -16, ty: -44 }, region: { x0: -17, y0: -44, x1: -15, y1: -43 }, maxAlive: 3, groupCap: 3,
    justification: 'The largest pocket of the forest that is no tree node\'s work position (four tiles, south-west quadrant): a literal clearing.',
  },
  {
    id: 'bosque-sotobosque-sureste', areaId: 'pradera', zoneId: 'pradera.bosque', group: 'sotobosque', habitats: [...SOTOBOSQUE],
    anchor: { tx: -6, ty: -43 }, region: { x0: -6, y0: -44, x1: -6, y1: -41 }, maxAlive: 3, groupCap: 3,
    justification: 'Three free tiles beside the north–south lane, south of the cross lane: undergrowth at the forest\'s main path.',
  },

  // ── Cueva inicial (interior; arrival S and exit E at the south) ───────────
  {
    id: 'cueva-techo-norte', areaId: 'cueva-inicial', zoneId: 'cueva-inicial', group: 'techo+suelo', habitats: ['cave-ceiling', 'cave-floor'],
    anchor: { tx: 10, ty: 2 }, region: { x0: 7, y0: 1, x1: 13, y1: 3 }, maxAlive: 3, groupCap: 3,
    justification: 'The far, highest part of the chamber, opposite the arrival: bats roost away from the entrance.',
  },
  {
    id: 'cueva-rincon-oeste', areaId: 'cueva-inicial', zoneId: 'cueva-inicial', group: 'rincón+húmedo', habitats: ['cave-nook', 'cave-damp-corner'],
    anchor: { tx: 3, ty: 7 }, region: { x0: 2, y0: 4, x1: 5, y1: 9 }, maxAlive: 3, groupCap: 3,
    justification: 'Western alcove beside the left pillar: nooks for Whismur and the rare Dunsparce.',
  },
  {
    id: 'cueva-roca-este', areaId: 'cueva-inicial', zoneId: 'cueva-inicial', group: 'roca+seco', habitats: ['cave-rocky-floor', 'cave-dry-floor'],
    anchor: { tx: 17, ty: 7 }, region: { x0: 15, y0: 3, x1: 18, y1: 9 }, maxAlive: 3, groupCap: 3,
    justification: 'Eastern side behind the right pillar: rocky, dry ground for Geodude and Sandshrew.',
  },
]

/** Provisional area caps (from ECO-BALANCE-1). The engine has one cap per presence area: see the report. */
export const PROVISIONAL_AREA_CAPS: Readonly<Record<string, number>> = { 'pradera.abierta': 12, 'pradera.bosque': 8, 'cueva-inicial': 6 }
