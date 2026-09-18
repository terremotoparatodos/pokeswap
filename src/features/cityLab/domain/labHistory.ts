// City Mapping Lab — undo/redo (DEV only).
//
// Cities are immutable and share structure between versions, so the history
// is just the list of versions; an undo is pointing at the previous one.

import type { LabCity } from './labCity'

const LIMIT = 200

export class LabHistory {
  private past: LabCity[] = []
  private future: LabCity[] = []

  constructor(private present: LabCity) {}

  get current(): LabCity {
    return this.present
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Records a new version; a no-op edit (same object) records nothing. */
  push(next: LabCity): void {
    if (next === this.present) return
    this.past.push(this.present)
    if (this.past.length > LIMIT) this.past.shift()
    this.present = next
    this.future = []
  }

  undo(): LabCity {
    const prev = this.past.pop()
    if (prev) {
      this.future.push(this.present)
      this.present = prev
    }
    return this.present
  }

  redo(): LabCity {
    const next = this.future.pop()
    if (next) {
      this.past.push(this.present)
      this.present = next
    }
    return this.present
  }

  /** Starts over from `city` (reset, import): the old versions are dropped. */
  reset(city: LabCity): void {
    this.past = []
    this.future = []
    this.present = city
  }
}
