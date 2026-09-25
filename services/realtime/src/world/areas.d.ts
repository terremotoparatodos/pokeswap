export interface WorldAreaDef {
  readonly id: string
  readonly seed: number | null
  readonly procedural: boolean
  readonly spawn: { readonly tx: number; readonly ty: number } | null
}
export declare const WORLD_AREAS: Readonly<Record<'pradera' | 'ciudad-corazon', WorldAreaDef>>
export declare function worldArea(areaId: string): WorldAreaDef | null
export declare const WORLD_CHUNK_TILES: 16
export declare function chunkOf(tx: number, ty: number): string
