// City Mapping Lab — what a press-drag-release in EDIT means (DEV only).
//
// One decision table, kept pure so it can be tested without a canvas:
//
//   Space held, middle or right button     → PAN, from anywhere (even over objects)
//   Seleccionar, press on an object         → drag that OBJECT once past the threshold
//   Seleccionar, press on empty ground      → PAN once past the threshold; a click deselects
//   Agregar                                 → a click PLACES; a drag PANS and places nothing
//   Terreno                                 → PAINT (the drag is the brush stroke)
//
// A press only becomes a drag after the pointer travels DRAG_THRESHOLD CSS px,
// so a slightly shaky click never pans, moves or fails to place.

export const DRAG_THRESHOLD = 5

export type EditTool = 'select' | 'add' | 'terrain'

export interface PressInput {
  readonly button: number
  readonly spaceHeld: boolean
  readonly altKey: boolean
  readonly tool: EditTool
  /** The press landed on a selectable entity. */
  readonly onEntity: boolean
}

/** What the press will do if it turns into a drag, and what a plain click does. */
export interface Gesture {
  readonly drag: 'pan' | 'object' | 'paint'
  readonly click: 'select' | 'deselect' | 'place' | 'paint' | 'none'
}

export function pressGesture(p: PressInput): Gesture {
  if (p.spaceHeld || p.altKey || p.button === 1 || p.button === 2) return { drag: 'pan', click: 'none' }
  if (p.tool === 'terrain') return { drag: 'paint', click: 'paint' }
  if (p.tool === 'add') return { drag: 'pan', click: 'place' }
  return p.onEntity ? { drag: 'object', click: 'select' } : { drag: 'pan', click: 'deselect' }
}

/** True once a press has travelled far enough to be a drag. */
export function isDrag(start: { x: number; y: number }, now: { x: number; y: number }, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= threshold
}
