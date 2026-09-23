export interface PresenceArrival { readonly tx: number; readonly ty: number; readonly dir: 'up' | 'down' | 'left' | 'right' }
export declare const ARRIVALS: Readonly<Record<'ciudad-corazon' | 'pradera', PresenceArrival>>
export declare const TOWN_FROM_PRADERA: PresenceArrival
export declare function arrivalFor(to: string, from: string | null): PresenceArrival | null
