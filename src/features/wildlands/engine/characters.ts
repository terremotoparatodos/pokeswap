// Character sprites — WildLands prototype
//
// Trainers are hand-authored 14×19 pixel grids with a swappable palette, so
// NPCs are recolours of the player. Wild Pokémon reuse the sprite_url images
// already stored in the database.

import { devWarn } from '../../../shared/utils/devTools'
import type { Actor } from './actors'
import { fromAscii, silhouette, spriteFromPixels, type Sprite } from './sprite'

export type Dir = 'down' | 'up' | 'left' | 'right'

const HEAD_DOWN = [
  '....KKKKKK....',
  '...KRRRRRRK...',
  '..KRRRWWRRRK..',
  '..KRRRRRRRRK..',
  '.KrrrrrrrrrrK.',
  '.KHKKKKKKKKHK.',
  '.KHSSSSSSSSHK.',
  '.KHSKSSSSKSHK.',
  '..KSSSSSSSSK..',
  '...KsSSSSsK...',
  '..KBBKssKBBK..',
  '.KSBBBBBBBBSK.',
  '.KSKBBBBBBKSK.',
  '.KKKbBBBBbKKK.',
  '..KPPPPPPPPK..',
]
const HEAD_UP = [
  '....KKKKKK....',
  '...KRRRRRRK...',
  '..KRRRRRRRRK..',
  '..KRRRRRRRRK..',
  '.KrrrrrrrrrrK.',
  '.KHHHHHHHHHHK.',
  '.KHHHHHHHHHHK.',
  '.KHHHHHHHHHHK.',
  '..KHHHHHHHHK..',
  '...KHHHHHHK...',
  '..KBKYYYYKBK..',
  '.KSBYYYYYYBSK.',
  '.KSBYyYYyYBSK.',
  '.KKKYYYYYYKKK.',
  '..KPKKKKKKPK..',
]
const HEAD_LEFT = [
  '.....KKKKK....',
  '....KRRRRRK...',
  '...KRRRWRRRK..',
  '..KRRRRRRRRK..',
  'KrrrrrrrrrrK..',
  '.KKKKHHHHHHK..',
  '..KSSSHHHHHK..',
  '..KSKSSHHHHK..',
  '..KSSSSSHHK...',
  '...KsSSSKK....',
  '...KBBBBYYK...',
  '...KBSSBYYK...',
  '...KBSSBYYK...',
  '...KbbbbKK....',
  '...KPPPPK.....',
]

const LEGS_FRONT = {
  idle: ['..KPPPKKPPPK..', '..KPPK..KPPK..', '..KGGK..KGGK..', '...KK....KK...'],
  stepA: ['..KPPPKKPPPK..', '..KGGK..KPPK..', '...KK...KGGK..', '.........KK...'],
  stepB: ['..KPPPKKPPPK..', '..KPPK..KGGK..', '..KGGK...KK...', '...KK.........'],
}
const LEGS_SIDE = {
  idle: ['...KPPPPK.....', '...KPPPPK.....', '...KGGGGK.....', '....KKKK......'],
  stride: ['..KPPKPPK.....', '.KPPK.KPPK....', '.KGGK.KGGK....', '..KK...KK.....'],
}

export type TrainerPalette = Record<string, string>

export const PLAYER_PALETTE: TrainerPalette = {
  K: '#1c1c24', R: '#e03c3c', r: '#a02a2a', W: '#ffffff', S: '#f8c898', s: '#d89868',
  H: '#4a3020', B: '#3a6fd0', b: '#284c94', P: '#3c4454', G: '#6a3c22', Y: '#f0c030', y: '#b88a18',
}

export const NPC_PALETTES: TrainerPalette[] = [
  { ...PLAYER_PALETTE, R: '#3a9a5a', r: '#246a3c', B: '#e8e8e8', b: '#a8a8b0', H: '#1c1c1c', Y: '#8a5a30', y: '#5a3a1c' },
  { ...PLAYER_PALETTE, R: '#8a5ac8', r: '#5c3a8c', B: '#d85a8a', b: '#9c3a60', H: '#c89ae0', P: '#2c2c3c' },
  { ...PLAYER_PALETTE, R: '#d8b870', r: '#a08448', B: '#8a7a50', b: '#5c5034', H: '#6a4a2a', S: '#e8b080' },
  { ...PLAYER_PALETTE, R: '#2c2c34', r: '#16161c', B: '#2c2c34', b: '#16161c', H: '#101010', P: '#1c1c24', Y: '#c83030' },
  { ...PLAYER_PALETTE, R: '#4ab0e0', r: '#2a7aa8', B: '#f0a040', b: '#b87020', H: '#e06a2a' },
  { ...PLAYER_PALETTE, R: '#f0f0f0', r: '#b0b0b8', B: '#4a8a4a', b: '#2c5c2c', H: '#8a8a8a', S: '#c89068' },
]

/** Frames per direction: [idle, stepA, idle, stepB] so walking reads as a 4-beat cycle. */
export type TrainerSprites = Record<Dir, Sprite[]>

function frame(rows: string[], palette: TrainerPalette, mirror = false): Sprite {
  const { w, h, pixels } = fromAscii(rows, palette, mirror)
  return spriteFromPixels(w, h, pixels, w / 2, h - 1)
}

export function buildTrainer(palette: TrainerPalette): TrainerSprites {
  const front = (head: string[]) => [
    frame([...head, ...LEGS_FRONT.idle], palette),
    frame([...head, ...LEGS_FRONT.stepA], palette),
    frame([...head, ...LEGS_FRONT.idle], palette),
    frame([...head, ...LEGS_FRONT.stepB], palette),
  ]
  // Bob the head one pixel on stride frames for a livelier gait.
  const side = (mirror: boolean) => [
    frame([...HEAD_LEFT, ...LEGS_SIDE.idle], palette, mirror),
    frame(['..............', ...HEAD_LEFT, ...LEGS_SIDE.stride.slice(1)], palette, mirror),
    frame([...HEAD_LEFT, ...LEGS_SIDE.idle], palette, mirror),
    frame(['..............', ...HEAD_LEFT, ...LEGS_SIDE.stride.slice(1)], palette, mirror),
  ]
  return { down: front(HEAD_DOWN), up: front(HEAD_UP), left: side(false), right: side(true) }
}

/** Two walk frames per facing direction. */
export type PokemonFrames = Record<Dir, Sprite[]>

const SHEET_ROWS: Dir[] = ['down', 'up', 'left', 'right']

function loadImage(url: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`sprite ${url}`))
    img.src = url
  })
}

function alphaOf(img: HTMLImageElement | HTMLCanvasElement): Uint8ClampedArray | null {
  try {
    const probe = document.createElement('canvas')
    probe.width = img.width
    probe.height = img.height
    const ctx = probe.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return ctx.getImageData(0, 0, img.width, img.height).data
  } catch {
    return null // Tainted canvas (remote image without CORS).
  }
}

/** Lowest and highest opaque rows within square cells, across the whole sheet. */
function cellBounds(img: HTMLImageElement | HTMLCanvasElement, cell: number): { feet: number; top: number } {
  const data = alphaOf(img)
  let lowest = -1
  let highest = cell
  if (data) {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (data[(y * img.width + x) * 4 + 3] > 16) {
          lowest = Math.max(lowest, y % cell)
          highest = Math.min(highest, y % cell)
        }
      }
    }
  }
  return lowest >= 0 ? { feet: lowest, top: highest } : { feet: cell - 1, top: 0 }
}

/** Degrees to rotate the red (cap) and blue (jacket, bag) hues of a trainer sheet. */
export interface HueShift {
  red: number
  blue: number
}

// Spread across the wheel so crowds read as different people:
// green/blue, yellow/orange, cyan/pink, purple/teal, red/green, teal/yellow.
export const NPC_HUE_SHIFTS: HueShift[] = [
  { red: 120, blue: 0 },
  { red: 50, blue: 170 },
  { red: 195, blue: 95 },
  { red: 275, blue: -60 },
  { red: 0, blue: -110 },
  { red: 160, blue: 180 },
]

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

/** Recolours saturated reds and blues; skin, hair and outlines are left alone. */
function recolor(img: HTMLImageElement, shift: HueShift): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const image = ctx.getImageData(0, 0, img.width, img.height)
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2])
    if (s < 0.3 || l < 0.12 || l > 0.92) continue
    const isRed = h >= 330 || h < 12
    const isBlue = h >= 195 && h <= 265
    if (!isRed && !isBlue) continue
    const [r, g, b] = hslToRgb((h + (isRed ? shift.red : shift.blue) + 360) % 360, s, l)
    d[i] = r; d[i + 1] = g; d[i + 2] = b
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export interface TrainerSheet {
  walk: TrainerSprites
  /** Present only when the sheet has run columns. */
  run?: TrainerSprites
}

/**
 * Trainer sheet (public/assets/trainers/*.png): rows down/up/left/right,
 * columns 0–3 walk and, optionally, 4–7 run. Square cells; frames follow
 * idle/step/idle/step.
 */
export async function loadTrainerSheet(url: string, shift?: HueShift): Promise<TrainerSheet> {
  const img = await loadImage(url, false)
  const source = shift ? recolor(img, shift) : img
  const cell = img.height / 4
  const { feet, top } = cellBounds(source, cell)
  const hasRun = img.width / cell >= 8
  const walk = {} as TrainerSprites
  const run = {} as TrainerSprites
  SHEET_ROWS.forEach((dir, row) => {
    const frame = (col: number): Sprite => ({ ...crop(source, col * cell, row * cell, cell, cell, feet), top })
    walk[dir] = [0, 1, 2, 3].map(frame)
    if (hasRun) run[dir] = [4, 5, 6, 7].map(frame)
  })
  return hasRun ? { walk, run } : { walk }
}

/** An actor that can wear trainer art (only NPCs are restyled here). */
type Wearer = Pick<Actor, 'kind' | 'homeTx' | 'homeTy' | 'trainer'>

/**
 * Swaps code-drawn NPCs for hue-shifted versions of the bundled sheet.
 * `looks` is refilled in place; on failure the drawn trainers stay. Player
 * appearance is intentionally independent (playerAppearance.ts).
 */
export function loadNpcTrainerArt(url: string, looks: TrainerSprites[], npcs: () => readonly Wearer[]): void {
  Promise.all(NPC_HUE_SHIFTS.map(shift => loadTrainerSheet(url, shift)))
    .then(sheets => {
      looks.splice(0, looks.length, ...sheets.map(s => s.walk))
      for (const actor of npcs()) {
        if (actor.kind === 'npc') actor.trainer = looks[Math.abs(actor.homeTx * 31 + actor.homeTy) % looks.length]
      }
    })
    .catch(error => devWarn('[wildlands] NPC sheets unavailable, keeping drawn trainers', error))
}

function crop(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, feet: number, mirror = false): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')!
  if (mirror) {
    ctx.translate(sw, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return { canvas, shadow: silhouette(canvas, sw, sh), w: sw, h: sh, ax: sw / 2, ay: feet }
}

export function overworldSheetUrl(id: number, shiny: boolean): string {
  return `/assets/overworld/${shiny ? 'shiny/' : ''}${String(id).padStart(4, '0')}.png`
}

/**
 * Overworld sheet bundled from terremotoparatodos/sprites-overworld:
 * rows down/up/left/right, two frames each, square cells of 32 or 64 px.
 */
export async function loadOverworldFrames(id: number, shiny: boolean): Promise<PokemonFrames> {
  const img = await loadImage(overworldSheetUrl(id, shiny), false)
  const cell = img.width / 2
  // Anchor every frame on the lowest opaque row so feet stay planted while animating.
  const { feet, top } = cellBounds(img, cell)
  const frames = {} as PokemonFrames
  SHEET_ROWS.forEach((dir, row) => {
    frames[dir] = [0, 1].map(col => ({ ...crop(img, col * cell, row * cell, cell, cell, feet), top }))
  })
  return frames
}

/** Fallback: the front sprite from sprite_url, trimmed and mirrored for right-facing. */
export async function loadFrontFrames(url: string): Promise<PokemonFrames> {
  const img = await loadImage(url, true)
  let sx = 0, sy = 0, sw = img.width, sh = img.height
  const data = alphaOf(img)
  if (data) {
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (data[(y * img.width + x) * 4 + 3] > 16) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x)
          y0 = Math.min(y0, y); y1 = Math.max(y1, y)
        }
      }
    }
    if (x1 >= x0) { sx = x0; sy = y0; sw = x1 - x0 + 1; sh = y1 - y0 + 1 }
  }
  const normal = crop(img, sx, sy, sw, sh, sh - 1)
  const mirrored = crop(img, sx, sy, sw, sh, sh - 1, true)
  return { down: [normal], up: [normal], left: [normal], right: [mirrored] }
}
