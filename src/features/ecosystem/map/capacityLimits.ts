// ECO-CAPACITY-1 — proposed initial capacity limits (data only). PROVISIONAL.
// Used by capacityProposal.ts (engine config) and nestData.ts (nests.json).
// Rationale and caveats: docs/design/ECO_CAPACITY_1_REPORT.md §3.

export interface ZoneCapacityProposal { readonly id: string; readonly maxAlive?: number; readonly catalogZone: string }

export const PROVISIONAL_CAPACITY: Readonly<Record<string, { readonly maxAlive: number; readonly zones: readonly ZoneCapacityProposal[] }>> = {
  pradera: {
    maxAlive: 18,
    zones: [{ id: 'abierta', maxAlive: 12, catalogZone: 'pradera.abierta' }, { id: 'bosque', maxAlive: 6, catalogZone: 'pradera.bosque' }],
  },
  'cueva-inicial': { maxAlive: 6, zones: [{ id: 'cueva', catalogZone: 'cueva-inicial' }] },
}
