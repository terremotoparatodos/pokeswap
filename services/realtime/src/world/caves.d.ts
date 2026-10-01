export interface CaveTile { readonly tx: number; readonly ty: number }

export type CaveEntranceStatus = 'closed' | 'open'

export interface Cave {
  readonly id: string
  readonly areaId: string
  readonly anchor: CaveTile
  readonly width: number
  readonly depth: number
  readonly facing: 'down'
  readonly footprint: readonly CaveTile[]
  readonly mouth: CaveTile
  readonly approach: CaveTile
  readonly clearance: readonly CaveTile[]
  readonly interiorAreaId: string
  readonly entrance: CaveEntranceStatus
}

export declare const CAVE_ENTRANCE: { readonly CLOSED: 'closed'; readonly OPEN: 'open' }
export declare const CAVE_CLEARANCE: { readonly width: number; readonly depth: number }
export declare const CAVES: readonly Cave[]

export declare function cavesIn(areaId: string): readonly Cave[]
export declare function isCaveRock(areaId: string, tx: number, ty: number): boolean
export declare function isCaveReserved(areaId: string, tx: number, ty: number): boolean
export declare function caveByInterior(areaId: string): Cave | null
export declare function isCaveMouth(areaId: string, tx: number, ty: number): boolean
