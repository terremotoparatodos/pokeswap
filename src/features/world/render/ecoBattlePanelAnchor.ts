// ECO-BATTLE-PANEL-1: keeps the battle panel beside its battle on screen, frame by frame.
//
// The camera follows the trainer, who may walk during the battle, so the scene moves on screen; the
// panel moves with it (placePanel). Its side is chosen once per battle — keyed by the encounter,
// away from where the trainer stood then — and kept until the panel closes: snapshots, events, a warning or Info opening never flip it.
// Read-only: it projects with the engine's last frame and decides nothing about the battle.

import { onUnmounted, shallowRef, type ShallowRef } from 'vue'
import { panelSide, placePanel, sceneRect, sideAwayFrom, type PanelSide, type ProjectWorld, type ScreenPoint } from '../domain/ecoBattlePanelPlacement'

export interface PanelAnchorInput {
  /** The panel is on screen. */
  active(): boolean
  /** The battle the panel belongs to (its side is kept per key). */
  key(): string | null
  /** The combatants' feet (world px): the scene, or the asked individual before the scene exists. */
  feet(): readonly { x: number; y: number }[]
  /** The trainer's feet (world px), read once per battle to start the panel on the other side. */
  trainer(): { x: number; y: number } | null
  project(): ProjectWorld | undefined
  /** The panel's own element, measured each frame (Info and warnings change its size). */
  panel(): HTMLElement | null
  /** The canvas: the screen the panel must stay on. */
  viewport(): HTMLElement | null
}

/** The panel's top-left corner in canvas CSS px; null keeps the panel's own fallback corner. */
export function usePanelAnchor(input: PanelAnchorInput): ShallowRef<ScreenPoint | null> {
  const anchor = shallowRef<ScreenPoint | null>(null)
  let side: { key: string; side: PanelSide } | null = null
  let frame = 0

  const place = () => {
    const key = input.key()
    const project = input.project()
    const panel = input.panel()
    const viewport = input.viewport()
    const scene = project ? sceneRect(input.feet(), project) : null
    if (!input.active() || !key || !scene || !panel || !viewport) {
      if (!input.active()) side = null
      if (anchor.value) anchor.value = null
      return
    }
    const size = { width: panel.offsetWidth, height: panel.offsetHeight }
    const screen = { width: viewport.clientWidth, height: viewport.clientHeight }
    if (side?.key !== key) {
      const at = input.trainer()
      const trainerX = at && project ? project(at.x, at.y)?.x ?? null : null
      side = { key, side: panelSide(scene, size, screen, sideAwayFrom(scene, trainerX)) }
    }
    const next = placePanel(scene, size, screen, side.side)
    const now = anchor.value
    if (!now || Math.abs(now.x - next.x) >= 0.5 || Math.abs(now.y - next.y) >= 0.5) anchor.value = next
  }
  const loop = () => { place(); frame = requestAnimationFrame(loop) }
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(loop)
  onUnmounted(() => { if (frame) cancelAnimationFrame(frame) })
  return anchor
}
