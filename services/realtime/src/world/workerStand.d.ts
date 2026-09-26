export interface WorkerStand {
  readonly tx: number
  readonly ty: number
  /** Facing toward the worked node. */
  readonly dir: 'up' | 'down' | 'left' | 'right'
}

export declare function workerStand(
  node: { readonly tx: number; readonly ty: number },
  trainer: { readonly tx: number; readonly ty: number },
  isOpen: (tx: number, ty: number) => boolean,
  isHidden?: (tx: number, ty: number) => boolean,
): WorkerStand

export declare function standableTile(areaId: string): (tx: number, ty: number) => boolean

export declare function hiddenBehindCanopy(areaId: string): (tx: number, ty: number) => boolean
