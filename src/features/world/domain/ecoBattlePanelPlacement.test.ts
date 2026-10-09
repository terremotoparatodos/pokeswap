// ECO-BATTLE-PANEL-1: the panel's place beside its battle — one side, on screen, never over the scene.

import { describe, expect, it } from 'vitest'
import { PANEL_GAP, SCREEN_EDGE, panelSide, placePanel, sceneRect, sideAwayFrom, type ScreenRect } from './ecoBattlePanelPlacement'

const viewport = { width: 800, height: 600 }
const panel = { width: 184, height: 160 }
const scene: ScreenRect = { left: 300, top: 250, right: 400, bottom: 330 }
const overlaps = (at: { x: number; y: number }, size: typeof panel, rect: ScreenRect) =>
  at.x < rect.right && at.x + size.width > rect.left && at.y < rect.bottom && at.y + size.height > rect.top

describe('where the battle panel stands (ECO-BATTLE-PANEL-1)', () => {
  it('the scene box covers both combatants and their bars, from the projected feet', () => {
    const project = (wx: number, wy: number) => ({ x: wx * 2, y: wy * 2, scale: 2 })
    expect(sceneRect([{ x: 100, y: 100 }, { x: 116, y: 100 }], project)).toEqual({ left: 160, top: 104, right: 272, bottom: 200 })
    expect(sceneRect([{ x: 0, y: 0 }], () => null)).toBeNull()
  })

  it('the side: the right one when it fits, else the left one', () => {
    expect(panelSide(scene, panel, viewport)).toBe('right')
    expect(panelSide({ ...scene, left: 560, right: 660 }, panel, viewport)).toBe('left')
    // neither fits (a narrow screen): right, and the clamp keeps it on screen
    expect(panelSide({ left: 100, top: 100, right: 300, bottom: 200 }, panel, { width: 320, height: 600 })).toBe('right')
  })

  it('away from the trainer when there is room there, so it does not start over the player', () => {
    expect(sideAwayFrom(scene, 500)).toBe('left') // the trainer on the right of the scene
    expect(sideAwayFrom(scene, 200)).toBe('right')
    expect(sideAwayFrom(scene, null)).toBe('right')
    expect(panelSide(scene, panel, viewport, 'left')).toBe('left')
    expect(panelSide({ ...scene, left: 120, right: 220 }, panel, viewport, 'left'), 'no room on the left').toBe('right')
  })

  it('beside the scene on its side, top-aligned with it, never over it', () => {
    const right = placePanel(scene, panel, viewport, 'right')
    expect(right).toEqual({ x: scene.right + PANEL_GAP, y: scene.top })
    const left = placePanel(scene, panel, viewport, 'left')
    expect(left).toEqual({ x: scene.left - PANEL_GAP - panel.width, y: scene.top })
    expect(overlaps(right, panel, scene)).toBe(false)
    expect(overlaps(left, panel, scene)).toBe(false)
  })

  it('growing (Info, a warning) extends it downwards: the corner does not move', () => {
    expect(placePanel(scene, { ...panel, height: 260 }, viewport, 'right')).toEqual(placePanel(scene, panel, viewport, 'right'))
  })

  it('moved only as much as needed to stay on screen', () => {
    expect(placePanel({ ...scene, top: -40, bottom: 40 }, panel, viewport, 'right')).toEqual({ x: scene.right + PANEL_GAP, y: SCREEN_EDGE })
    expect(placePanel({ ...scene, top: 520, bottom: 600 }, panel, viewport, 'right').y).toBe(viewport.height - panel.height - SCREEN_EDGE)
  })

  it('pushed onto the combatants by the edge, it steps below the scene (or above it when there is no room below)', () => {
    const atEdge: ScreenRect = { left: 600, top: 200, right: 700, bottom: 280 }
    const below = placePanel(atEdge, panel, viewport, 'right')
    expect(below).toEqual({ x: viewport.width - panel.width - SCREEN_EDGE, y: atEdge.bottom + PANEL_GAP })
    expect(overlaps(below, panel, atEdge)).toBe(false)
    const low: ScreenRect = { left: 600, top: 400, right: 700, bottom: 480 }
    const above = placePanel(low, panel, viewport, 'right')
    expect(above.y).toBe(low.top - PANEL_GAP - panel.height)
    expect(overlaps(above, panel, low)).toBe(false)
  })
})
