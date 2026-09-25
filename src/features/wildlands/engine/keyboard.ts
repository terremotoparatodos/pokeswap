// Keyboard input — WildLands prototype
//
// Held arrow/WASD keys (last pressed wins), Shift to run, an on-screen d-pad
// direction, and one-shot action keys. Touch screens run through `runMode`, a
// toggle that feeds the same gait as Shift (MOBILE-1).

import type { Dir } from './characters'
import { isDev } from '../../../shared/utils/devTools'

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
}

export interface KeyActions {
  cycleLens: () => void
  toggleGrid: () => void
  skipTime: () => void
  interact: () => void
}

export class KeyboardInput {
  readonly held: Dir[] = []
  virtualDir: Dir | null = null
  /** Shift held (or a scripted measurement run). Cleared with the other keys. */
  private shiftHeld = false
  /**
   * The touch Correr toggle: a movement mode, not a held key, so losing focus,
   * a panel or a trip does not end it. Only the toggle itself does.
   */
  runMode = false

  constructor(private readonly actions: KeyActions) {}

  /** Walk or run for the next step: the one gait Shift and the touch toggle share. */
  get sprinting(): boolean {
    return this.shiftHeld || this.runMode
  }

  set sprinting(on: boolean) {
    this.shiftHeld = on
  }

  /** Direction currently requested: the d-pad first, then the last held key. */
  get direction(): Dir | null {
    return this.virtualDir ?? this.held[this.held.length - 1] ?? null
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.clear)
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.clear)
    // A key released while detached (panel open, tab hidden) never delivers
    // its keyup here. Keeping it would make the player walk on its own after
    // re-attaching, e.g. straight through the west gate into Pradera.
    this.clear()
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'Shift') this.shiftHeld = true
    const dir = KEY_DIRS[e.code]
    if (dir) {
      e.preventDefault()
      if (!this.held.includes(dir)) this.held.push(dir)
      return
    }
    if (e.repeat) return
    // Alternate lenses are a development aid only; players always get each area's lens.
    if (e.code === 'KeyV' && isDev) this.actions.cycleLens()
    else if (e.code === 'KeyG') this.actions.toggleGrid()
    else if (e.code === 'KeyN') this.actions.skipTime()
    else if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); this.actions.interact() }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const index = this.held.indexOf(KEY_DIRS[e.code])
    if (index >= 0) this.held.splice(index, 1)
    if (e.key === 'Shift') this.shiftHeld = false
  }

  private readonly clear = (): void => {
    this.held.length = 0
    this.virtualDir = null
    this.shiftHeld = false
  }
}
