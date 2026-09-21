import type { CameraLens, Projector } from './projection'

/**
 * Projection data shared by every frame whose viewport and lens are stable.
 *
 * Ground projection still draws one exact canvas row at a time, but it no
 * longer repeats the perspective divisions or allocates a `{ wy, scale }`
 * object for every row of every frame.
 */
export class ProjectionRowCache {
  private cachedTop = -1
  private cachedHeight = -1
  private cachedFocusY = Number.NaN
  private cachedZoom = Number.NaN
  private cachedSquash = Number.NaN
  private cachedDistance = Number.NaN

  readonly worldY: number[] = []
  readonly inverseScale: number[] = []

  prepare(proj: Projector, top: number, height: number, focusY: number, lens: CameraLens): this {
    if (
      top === this.cachedTop && height === this.cachedHeight && focusY === this.cachedFocusY &&
      lens.zoom === this.cachedZoom && lens.squash === this.cachedSquash && lens.distance === this.cachedDistance
    ) return this

    this.cachedTop = top
    this.cachedHeight = height
    this.cachedFocusY = focusY
    this.cachedZoom = lens.zoom
    this.cachedSquash = lens.squash
    this.cachedDistance = lens.distance
    this.worldY.length = height - top
    this.inverseScale.length = height - top

    for (let sy = top; sy < height; sy++) {
      const row = proj.row(sy + 0.5)
      const index = sy - top
      this.worldY[index] = row?.wy ?? Number.NaN
      this.inverseScale[index] = row ? 1 / row.scale : Number.NaN
    }
    return this
  }
}
