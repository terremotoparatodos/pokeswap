export interface ZoneBox { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

export interface ResourceZone {
  readonly id: string
  readonly areaId: string
  readonly label: string
  readonly box: ZoneBox
  /** Props that are resource nodes inside the zone. */
  readonly nodes: readonly string[]
  readonly lanes: readonly ZoneBox[]
  readonly buffers: readonly ZoneBox[]
  readonly entry: { readonly tx: number; readonly ty: number }
}

export declare const RESOURCE_ZONES: readonly ResourceZone[]
export declare const RESERVED_AREAS: readonly { readonly id: string; readonly areaId: string; readonly box: ZoneBox }[]
export declare const ARRIVAL_CLEARANCE: { readonly areaId: string; readonly box: ZoneBox; readonly margin: number }
export declare const ROUTES: readonly { readonly id: string; readonly areaId: string; readonly to: string; readonly box: ZoneBox }[]

export declare function hasResourceZones(areaId: string): boolean
export declare function resourceZoneAt(areaId: string, tx: number, ty: number): ResourceZone | null
export declare function isPlannedTile(areaId: string, tx: number, ty: number): boolean
export declare function isCorridorTile(areaId: string, tx: number, ty: number): boolean
export declare function decorAtArea(areaId: string | null, seed: number, tx: number, ty: number, corners?: readonly number[]): string | null
export declare function isSolidAtArea(areaId: string | null, seed: number, tx: number, ty: number): boolean
