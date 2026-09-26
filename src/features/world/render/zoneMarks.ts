// Where the resource zones are (MAP-2): a trodden-earth trail on the routes
// from the arrival and along each zone's corridors, and a name at each zone
// entry. Ground marks and labels like the rest of the overlay — no sprites,
// no new art — read from the same zone plan the server uses.

import { RESOURCE_ZONES, ROUTES, type ZoneBox } from '../../../../services/realtime/src/world/resourceZones.js'
import type { OverlayLabel } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { hash2 } from '../../wildlands/engine/noise'

export interface TrailTile {
  readonly tx: number
  readonly ty: number
}

const tilesOf = (box: ZoneBox): TrailTile[] => {
  const out: TrailTile[] = []
  for (let ty = box.y0; ty <= box.y1; ty++) for (let tx = box.x0; tx <= box.x1; tx++) out.push({ tx, ty })
  return out
}

const trailCache = new Map<string, readonly TrailTile[]>()

/** Route and corridor tiles of an area, each once. */
export function trailTiles(areaId: string): readonly TrailTile[] {
  let tiles = trailCache.get(areaId)
  if (!tiles) {
    const seen = new Map<string, TrailTile>()
    const boxes = [...ROUTES.filter(route => route.areaId === areaId).map(route => route.box), ...RESOURCE_ZONES.filter(zone => zone.areaId === areaId).flatMap(zone => zone.lanes)]
    for (const box of boxes) for (const tile of tilesOf(box)) seen.set(`${tile.tx},${tile.ty}`, tile)
    tiles = [...seen.values()]
    trailCache.set(areaId, tiles)
  }
  return tiles
}

/** Trodden earth: a soft patch per tile and two pebbles, fixed per tile. */
export function drawTrail(g: CanvasRenderingContext2D, tiles: readonly TrailTile[], x0: number, y0: number, width: number, height: number): void {
  g.save()
  for (const { tx, ty } of tiles) {
    const cx = tx * TILE + TILE / 2 - x0
    const cy = ty * TILE + TILE / 2 - y0
    if (cx < -TILE || cy < -TILE || cx > width + TILE || cy > height + TILE) continue
    g.fillStyle = 'rgba(150, 118, 74, 0.38)'
    g.beginPath(); g.ellipse(cx, cy, TILE * 0.62, TILE * 0.5, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = 'rgba(96, 74, 46, 0.55)'
    for (let i = 0; i < 2; i++) {
      const px = cx + (hash2(tx, ty, 71 + i) - 0.5) * TILE * 0.8
      const py = cy + (hash2(tx, ty, 83 + i) - 0.5) * TILE * 0.6
      g.fillRect(Math.round(px), Math.round(py), 2, 1)
    }
  }
  g.restore()
}

/** Each zone's name over its entry. */
export function zoneLabels(areaId: string): readonly OverlayLabel[] {
  return RESOURCE_ZONES.filter(zone => zone.areaId === areaId).map(zone => ({
    wx: zone.entry.tx * TILE + TILE / 2, wy: zone.entry.ty * TILE + TILE - 2, lift: 22,
    text: zone.label, color: zone.id === 'bosque' ? '#d8f5c4' : '#f3dcbd', alpha: 0.95,
  }))
}
