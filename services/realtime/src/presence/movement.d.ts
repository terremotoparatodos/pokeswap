export interface MovingActor {
  tx: number; ty: number; dir: string; speed: number; moveSequence?: number
  moveTokens?: number; moveTokensAt?: number; lastMoveAt?: number
}
export declare const TILE_PER_SECOND: number
export declare const MOVE_TOKENS_PER_SECOND: number
export declare const MOVE_BURST_CAPACITY: number
/** Returns `null` when the move is accepted (and applied), else the rejection reason. */
export declare function applyMove(actor: MovingActor, direction: string, now: number, running: boolean, sequence?: number | null): string | null
export declare function acceptMove(actor: MovingActor, direction: string, now: number, running: boolean, sequence?: number | null): MovingActor | null
