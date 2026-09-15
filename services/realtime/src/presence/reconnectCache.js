/** Short-lived server memory for a browser refresh. It is never persisted. */
export const RECONNECT_GRACE_MS = 15_000

export class ReconnectCache {
  #actors = new Map()

  take(id, now = Date.now()) {
    const entry = this.#actors.get(id)
    if (!entry || entry.expiresAt <= now) {
      this.#actors.delete(id)
      return null
    }
    this.#actors.delete(id)
    return entry.actor
  }

  remember(id, actor, now = Date.now()) {
    const expiresAt = now + RECONNECT_GRACE_MS
    this.#actors.set(id, { actor, expiresAt })
    const timer = setTimeout(() => {
      const entry = this.#actors.get(id)
      if (entry?.expiresAt === expiresAt) this.#actors.delete(id)
    }, RECONNECT_GRACE_MS)
    timer.unref?.()
  }
}
