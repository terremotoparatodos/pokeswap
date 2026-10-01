export interface TownTile { readonly tx: number; readonly ty: number }
export type TownDir = 'up' | 'down' | 'left' | 'right'

export interface TownBuildingFootprint {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly d: number
  readonly open?: readonly TownTile[]
  readonly door?: TownTile
}

export interface TownFountainRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

export type TownSolidPropKind = 'lamp' | 'sign' | 'hedge' | 'fenceH' | 'fenceV' | 'bench' | 'benchLeft'

export interface TownPropPlacement extends TownTile {
  readonly kind: TownSolidPropKind
  /** Signs only: which text the browser shows. */
  readonly key?: string
  /** The activity board. */
  readonly board?: boolean
}

export interface TownGateNavigation {
  readonly to: string
  readonly tiles: readonly TownTile[]
  readonly arrival: TownTile & { readonly dir: TownDir }
}

export interface TownCollisionDef {
  readonly terrain: readonly string[]
  readonly buildings: readonly { readonly x: number; readonly y: number; readonly w: number; readonly d: number; readonly open?: readonly TownTile[]; readonly door?: TownTile }[]
  readonly fountains: readonly TownFountainRect[]
  readonly props: readonly { readonly kind: string; readonly tx: number; readonly ty: number }[]
  readonly gates: readonly { readonly tiles: readonly TownTile[] }[]
}

export declare const TOWN_AREA_ID: 'ciudad-corazon'
export declare const TOWN_TERRAIN: readonly string[]
export declare const TOWN_SPAWN: TownTile & { readonly dir: TownDir }
export declare const TOWN_BUILDINGS: readonly TownBuildingFootprint[]
export declare const TOWN_FOUNTAINS: readonly TownFountainRect[]
export declare const TOWN_SOLID_PROP_KINDS: readonly TownSolidPropKind[]
export declare const TOWN_PROP_SIZE: Readonly<Record<string, { readonly w: number; readonly d: number }>>
export declare const TOWN_PROPS: readonly TownPropPlacement[]
export declare const TOWN_GATES: readonly TownGateNavigation[]
export declare const TOWN_WIDTH: number
export declare const TOWN_HEIGHT: number

export declare function townPropSize(kind: string): { readonly w: number; readonly d: number }
export declare function townPropTiles(prop: { kind: string; tx: number; ty: number }): { tx: number; ty: number }[]
export declare function townCollision(def: TownCollisionDef): Uint8Array
export declare function isTownWalkable(tx: number, ty: number): boolean
export declare function townGateAt(tx: number, ty: number): TownGateNavigation | null
export declare function isTownDoor(tx: number, ty: number): boolean
