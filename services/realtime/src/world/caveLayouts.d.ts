export interface CaveInteriorTile { readonly tx: number; readonly ty: number }

export interface CaveInterior {
  readonly id: string
  readonly name: string
  readonly width: number
  readonly height: number
  readonly rows: readonly string[]
  readonly arrival: CaveInteriorTile & { readonly dir: 'up' | 'down' | 'left' | 'right' }
  readonly exit: CaveInteriorTile
}

export declare const CAVE_INTERIORS: Readonly<Record<string, CaveInterior>>

export declare function caveInterior(areaId: string): CaveInterior | null
export declare function isCaveInterior(areaId: string): boolean
export declare function isCaveFloor(areaId: string, tx: number, ty: number): boolean
export declare function isCaveExit(areaId: string, tx: number, ty: number): boolean
