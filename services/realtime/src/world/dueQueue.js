/**
 * Everything the world must do at a given time — action completions and
 * respawns — in one min-heap, drained by the room's existing 50 ms tick.
 *
 * No timer per node: ten thousand depleted rocks cost one comparison per tick.
 * Entries are never removed early; a handler re-checks the state it expects
 * (action id, node version), so a stale entry is a harmless no-op. That same
 * re-check is what makes a duplicated entry unable to act twice.
 */
export class DueQueue {
  #heap = []

  push(at, task) {
    const heap = this.#heap
    heap.push({ at, task })
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent].at <= heap[i].at) break
      ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
      i = parent
    }
  }

  /** Removes and returns every task due at `now`, earliest first. */
  drain(now) {
    const due = []
    while (this.#heap.length && this.#heap[0].at <= now) due.push(this.#pop().task)
    return due
  }

  get size() {
    return this.#heap.length
  }

  #pop() {
    const heap = this.#heap
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let smallest = i
        if (l < heap.length && heap[l].at < heap[smallest].at) smallest = l
        if (r < heap.length && heap[r].at < heap[smallest].at) smallest = r
        if (smallest === i) break
        ;[heap[smallest], heap[i]] = [heap[i], heap[smallest]]
        i = smallest
      }
    }
    return top
  }
}
