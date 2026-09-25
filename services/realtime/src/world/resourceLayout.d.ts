import type { Biome } from './terrain.js'

export type ResourceKind = 'tree' | 'rock'
export type WorkKind = 'chop' | 'mine'
export type ResourceVariantId = 'tree' | 'pine' | 'snowpine' | 'palm' | 'rock' | 'boulder' | 'icerock'

export interface ResourceNodeBase {
  readonly id: string
  readonly resourceKind: ResourceKind
  readonly variantId: ResourceVariantId
  readonly areaId: string
  readonly chunkId: string
  readonly tx: number
  readonly ty: number
  readonly zone: number
  readonly biome: Biome
}

export declare const RESOURCE_KIND: Readonly<{ TREE: 'tree'; ROCK: 'rock' }>
export declare const WORK_KIND: Readonly<Record<ResourceKind, WorkKind>>
export declare const RESOURCE_VARIANTS: Readonly<Record<ResourceVariantId, { readonly kind: ResourceKind; readonly density: number }>>
export declare const RESPAWN_MS: Readonly<Record<ResourceKind, number>>
export declare function resourceId(areaId: string, tx: number, ty: number, variantId: string): string
export declare function resourceAt(areaId: string, tx: number, ty: number): ResourceNodeBase | null
export declare function resourceById(id: string): ResourceNodeBase | null
export declare function resourcesInChunk(areaId: string, cx: number, cy: number, chunkTiles?: number): ResourceNodeBase[]
