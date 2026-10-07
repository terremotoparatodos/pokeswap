// Real-map geometry for nest proposals (ECO-MAP-1), read from the generated
// snapshot of the shared world modules (scripts/ecosystem/map-geometry.mjs).
// Pure: no server or Node import. The snapshot's freshness is checked by
// `--check` and by geometry.test.ts.

export type GeometryFlag =
  | 'blocked' | 'unreachable' | 'water' | 'portal' | 'resource' | 'work' | 'corridor'
  | 'reserved' | 'arrivalClearance' | 'caveReserved' | 'tall' | 'nearWater'

export interface Box { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
export interface ProtectedPoint { readonly kind: string; readonly tx: number; readonly ty: number }

export interface AreaSnapshot {
  readonly areaId: string
  readonly layoutVersion: string
  readonly window: { readonly minTx: number; readonly minTy: number; readonly maxTx: number; readonly maxTy: number }
  readonly entry: { readonly tx: number; readonly ty: number }
  readonly protected: readonly ProtectedPoint[]
  readonly subzones: readonly { readonly id: string; readonly box: Box }[]
  /** One row per ty; 3 hex digits per tile (bit mask, see `bits`). */
  readonly rows: readonly string[]
}

export interface GeometrySnapshot {
  readonly generatedBy: string
  readonly terrainGenerator: number
  readonly bits: Readonly<Record<GeometryFlag, number>>
  readonly areas: Readonly<Record<string, AreaSnapshot>>
}

export interface AreaGeometryView {
  readonly area: AreaSnapshot
  inWindow(tx: number, ty: number): boolean
  /** Every static fact of a tile; outside the window, only `blocked`. */
  flags(tx: number, ty: number): ReadonlySet<GeometryFlag>
  subzoneAt(tx: number, ty: number): string | null
}

export const inBox = (b: Box, tx: number, ty: number): boolean => tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1

export function areaView(snapshot: GeometrySnapshot, areaId: string): AreaGeometryView | null {
  const area = snapshot.areas[areaId]
  if (!area) return null
  const w = area.window
  const names = Object.entries(snapshot.bits) as [GeometryFlag, number][]
  const inWindow = (tx: number, ty: number) => Number.isInteger(tx) && Number.isInteger(ty) && tx >= w.minTx && tx <= w.maxTx && ty >= w.minTy && ty <= w.maxTy
  return {
    area,
    inWindow,
    flags(tx, ty) {
      if (!inWindow(tx, ty)) return new Set<GeometryFlag>(['blocked'])
      const i = (tx - w.minTx) * 3
      const mask = parseInt(area.rows[ty - w.minTy].slice(i, i + 3), 16)
      return new Set(names.filter(([, bit]) => mask & (1 << bit)).map(([name]) => name))
    },
    subzoneAt(tx, ty) {
      return area.subzones.find(z => inBox(z.box, tx, ty))?.id ?? null
    },
  }
}
