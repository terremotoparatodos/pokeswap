import type { EcoBattleStage } from './worldProtocol.js'

// ECO-BATTLE-SCENE-1: types of the battle scene rules (ecoScene.js).

type Tile = { readonly tx: number; readonly ty: number }
type Dir = 'up' | 'down' | 'left' | 'right'

export declare function wildWalkable(areaId: string, tx: number, ty: number): boolean
export declare function encounterPatrol(encounter: { readonly id: string; readonly areaId: string; readonly tx: number; readonly ty: number }): unknown
export declare function wildPoseAt(encounter: { readonly id: string; readonly areaId: string; readonly tx: number; readonly ty: number }, nowMs: number): Tile
export declare function facing(from: Tile, to: Tile): Dir
export declare function battleStage(input: { readonly areaId: string; readonly trainer: Tile; readonly wild: Tile }): EcoBattleStage | null
