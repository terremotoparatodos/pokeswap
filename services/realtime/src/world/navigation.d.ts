export interface AreaBounds { readonly minTx: number; readonly minTy: number; readonly maxTx: number; readonly maxTy: number }
export interface NavigationPortal { readonly areaId: string; readonly tx: number; readonly ty: number; readonly to: string }

export declare const AREA_BOUNDS: Readonly<Record<string, AreaBounds>>
export declare const PRADERA_RETURN_PAD: { readonly tx: number; readonly ty: number }
export declare const PORTALS: readonly NavigationPortal[]

export declare function insideAreaBounds(areaId: string, tx: number, ty: number): boolean
export declare function isWalkable(areaId: string, tx: number, ty: number): boolean
export declare function portalAt(areaId: string, tx: number, ty: number): string | null
export declare function nextHop(from: string, to: string): string | null
export declare function portalTo(from: string, to: string): NavigationPortal | null
export declare function isReachable(areaId: string, tx: number, ty: number): boolean
export declare function isSafeLanding(areaId: string, tx: number, ty: number): boolean
