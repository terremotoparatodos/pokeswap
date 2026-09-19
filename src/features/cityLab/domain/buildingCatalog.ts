// City Mapping Lab — buildings the palette can place from scratch (DEV only).
//
// Only art the game already has: one template per hand-drawn building PNG in
// Ciudad Corazón (same style, footprint, roof line and walkable stairs), the
// handheld games' 3D models that no city building uses yet, and the engine's
// code-painted blocks, whose footprint can be any size. A new building starts
// with no PokeSwap function; the inspector gives it one.

import { HEARTHOME } from '../../wildlands/areas/atlas'
import type { ArtImage, TownBuilding } from '../../wildlands/areas/townArea'
import type { BuildingStyle } from '../../wildlands/engine/buildings'
import type { Tile } from '../../wildlands/engine/pathfinding'

export interface BuildingTemplate {
  /** `art:<png name>`, `model:<model id>` or `block:<style>`. */
  readonly id: string
  readonly label: string
  readonly group: 'art' | 'model' | 'block'
  readonly style: BuildingStyle
  readonly w: number
  readonly d: number
  readonly image?: ArtImage
  /** Walkable footprint tiles (stairs), relative to the top-left tile. */
  readonly open?: readonly Tile[]
  /** Where the source building has its door, relative (column on the bottom row). */
  readonly doorColumn?: number
  readonly name: string
  readonly blurb: string
}

const LABELS: Record<string, string> = {
  contest: 'Salón de Concursos', 'amity-gate': 'Plaza Amistad (escalera)', 'route-gate': 'Puerta de ruta',
  pokecenter: 'Centro Pokémon', 'house-green': 'Casa verde', 'house-blue': 'Casa azul',
  'apartment-a': 'Departamentos A', 'apartment-b': 'Departamentos B', gym: 'Gimnasio',
  fanclub: 'Club de Fans', mart: 'Tienda', poffin: 'Casa de los Poffins',
}

const BLOCK_LABELS: Record<BuildingStyle, string> = {
  house: 'Casa', redhouse: 'Casa roja', apartment: 'Departamentos', pokecenter: 'Centro', mart: 'Tienda',
  gym: 'Gimnasio', contest: 'Salón', amityGate: 'Portal azul', routeGate: 'Portal marrón',
}

/** `/assets/town/house-green.png` → `house-green`. */
export const artName = (src: string) => src.replace(/^.*\//, '').replace(/\.png$/, '')

function fromBuilding(b: TownBuilding): BuildingTemplate {
  const name = artName(b.image!.src)
  return {
    id: `art:${name}`,
    label: LABELS[name] ?? name,
    group: 'art',
    style: b.style,
    w: b.w,
    d: b.d,
    image: { ...b.image! },
    ...(b.open ? { open: b.open.map(t => ({ tx: t.tx - b.x, ty: t.ty - b.y })) } : {}),
    ...(b.door ? { doorColumn: b.door.tx - b.x } : {}),
    name: 'Edificio nuevo',
    blurb: '',
  }
}

const ART_TEMPLATES: BuildingTemplate[] = []
for (const b of HEARTHOME.buildings) {
  if (b.image && !ART_TEMPLATES.some(t => t.image!.src === b.image!.src)) ART_TEMPLATES.push(fromBuilding(b))
}

/**
 * 3D models (scripts/build_town_models.py) no city building uses: their front
 * render is the palette thumbnail and loading fallback. Footprints fit the model.
 */
const MODEL_BUILDINGS: readonly { id: string; label: string; style: BuildingStyle; w: number; d: number }[] = [
  { id: 'casino', label: 'Casino (Game Corner)', style: 'contest', w: 7, d: 4 },
]

const MODEL_TEMPLATES: BuildingTemplate[] = MODEL_BUILDINGS.map(m => ({
  id: `model:${m.id}`, label: m.label, group: 'model', style: m.style, w: m.w, d: m.d,
  image: { src: `/assets/town/models/${m.id}-sprite.png`, model: `/assets/town/models/${m.id}.json` },
  name: 'Edificio nuevo', blurb: '',
}))

/** Default footprint of a code-painted block: a small house. */
export const BLOCK_SIZE = { w: 4, d: 4 } as const
/** Footprints the inspector accepts, in tiles. */
export const SIZE_LIMITS = { min: 1, max: 12 } as const

const BLOCK_TEMPLATES: BuildingTemplate[] = (Object.keys(BLOCK_LABELS) as BuildingStyle[]).map(style => ({
  id: `block:${style}`, label: BLOCK_LABELS[style], group: 'block', style, ...BLOCK_SIZE, name: 'Edificio nuevo', blurb: '',
}))

export const BUILDING_TEMPLATES: readonly BuildingTemplate[] = [...ART_TEMPLATES, ...MODEL_TEMPLATES, ...BLOCK_TEMPLATES]

export function buildingTemplate(id: string): BuildingTemplate | null {
  return BUILDING_TEMPLATES.find(t => t.id === id) ?? null
}

/** The template a building's look matches (same PNG, or same painted style without art). */
export function templateOf(b: Pick<TownBuilding, 'style' | 'image'>): BuildingTemplate | null {
  if (b.image) return BUILDING_TEMPLATES.find(t => t.image?.src === b.image!.src) ?? null
  return buildingTemplate(`block:${b.style}`)
}

/**
 * Where a building added with the cursor on `at` goes: the cursor marks the
 * middle of its bottom row (where a door usually is).
 */
export function buildingOrigin(t: Pick<BuildingTemplate, 'w' | 'd'>, at: Tile): { x: number; y: number } {
  return { x: at.tx - Math.floor(t.w / 2), y: at.ty - t.d + 1 }
}
