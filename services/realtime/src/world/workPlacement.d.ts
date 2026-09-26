export type PlacementDir = 'up' | 'down' | 'left' | 'right'

export interface WorkerStand {
  readonly tx: number
  readonly ty: number
  /** Facing toward the worked node. */
  readonly dir: PlacementDir
}

export declare function workPlacement(
  node: { readonly tx: number; readonly ty: number },
  trainer: { readonly tx: number; readonly ty: number },
  isOpen: (tx: number, ty: number) => boolean,
): { stand: WorkerStand; wait: WorkerStand } | null

export declare function standableTile(areaId: string): (tx: number, ty: number) => boolean
