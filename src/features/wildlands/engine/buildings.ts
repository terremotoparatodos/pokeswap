// Town buildings — WildLands prototype
//
// Placeholder blocks sized to a footprint (tiles × 16 px). Towns show
// hand-drawn PNGs; these only stand in while an image loads or if it fails,
// so buildings stay visible and the first ground bake has real dimensions.
// The upper part is the roof seen from above (`flatTop`, squashed by the
// camera tilt) and the lower part is the upright façade with a door.

import { Painter } from './painter'
import type { Sprite } from './sprite'

export type BuildingStyle =
  | 'pokecenter' | 'house' | 'apartment' | 'gym' | 'mart' | 'redhouse'
  | 'contest' | 'amityGate' | 'routeGate'

export interface BuildingSpec {
  style: BuildingStyle
  /** Footprint in tiles. */
  w: number
  d: number
}

interface Look {
  roof: string
  eave: string
  wall: string
  /** Façade height in px. */
  wallH: number
}

const OUTLINE = '#2a2230'
const T = 16

const LOOKS: Record<BuildingStyle, Look> = {
  pokecenter: { roof: '#e8862a', eave: '#b8561a', wall: '#a8aeb6', wallH: 26 },
  house: { roof: '#58b060', eave: '#3a8a44', wall: '#b4a07a', wallH: 30 },
  apartment: { roof: '#7a4a4e', eave: '#4c3036', wall: '#746c5e', wallH: 50 },
  gym: { roof: '#ae794b', eave: '#6c492a', wall: '#94949a', wallH: 34 },
  mart: { roof: '#5a8ad0', eave: '#3a5c9a', wall: '#b8c0d0', wallH: 22 },
  redhouse: { roof: '#c0503a', eave: '#8a3424', wall: '#b8a888', wallH: 36 },
  contest: { roof: '#e8b0c8', eave: '#b07890', wall: '#d8d0e0', wallH: 34 },
  amityGate: { roof: '#6c90d0', eave: '#495573', wall: '#8a98ae', wallH: 42 },
  routeGate: { roof: '#6c79b0', eave: '#6a4c40', wall: '#86644c', wallH: 30 },
}

export function buildingSprite(spec: BuildingSpec): Sprite {
  const look = LOOKS[spec.style]
  const p = new Painter(spec.w * T, spec.d * T)
  const wallH = Math.min(look.wallH, p.h - 12)
  const roofH = p.h - wallH
  // Roof: light back edge, body, eave.
  p.rect(1, 2, p.w - 2, roofH - 2, look.roof)
  p.hline(1, 2, p.w - 2, '#ffffff')
  p.rect(1, roofH - 6, p.w - 2, 6, look.eave)
  // Façade with a darker footing, a door and a window each side.
  p.rect(1, roofH, p.w - 2, wallH, look.wall)
  p.rect(1, p.h - 3, p.w - 2, 3, look.eave)
  const cx = Math.round(p.w / 2)
  p.rect(cx - 6, p.h - 18, 12, 18, '#3c3a48')
  for (const wx of [8, p.w - 20]) p.rect(wx, roofH + 6, 12, 8, '#8fc8e8')
  p.outline(OUTLINE)
  return p.toSprite({ flatTop: roofH, castShadow: false })
}
