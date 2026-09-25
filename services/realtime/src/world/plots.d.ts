export interface PlotDef {
  readonly id: string
  readonly resourceKind: 'plot'
  readonly variantId: 'plot'
  readonly plotKind: 'town' | 'fertile'
  readonly areaId: string
  readonly chunkId: string
  readonly tx: number
  readonly ty: number
  readonly zone: number
  readonly biome: string
}
export declare const PLOT_KIND: 'plot'
export declare const PLOTS: readonly PlotDef[]
export declare function plotById(id: string): PlotDef | null
export declare function plotStageAt(data: { growingAt: number; readyAt: number } | null, now: number): 'empty' | 'planted' | 'growing' | 'ready'
