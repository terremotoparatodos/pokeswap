export type PatrolDir = 'up' | 'down' | 'left' | 'right'
export interface Patrol {
  readonly key: string
  readonly speed: number
  readonly periodMs: number
  readonly phaseMs: number
  readonly beats: readonly { t: number; fromTx: number; fromTy: number; tx: number; ty: number; dir: PatrolDir; moving: boolean }[]
}
export interface PatrolPose { fromTx: number; fromTy: number; tx: number; ty: number; dir: PatrolDir; progress: number }
export declare const PATROL_LEASH: number
export declare function keySeed(key: string): number
export declare function buildPatrol(options: { key: string; home: { tx: number; ty: number }; walkable: (tx: number, ty: number) => boolean; speed: number; leash?: number }): Patrol
export declare function samplePatrol(patrol: Patrol, nowMs: number): PatrolPose
