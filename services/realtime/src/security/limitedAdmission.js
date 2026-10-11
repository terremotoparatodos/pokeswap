import { ServerError } from '@colyseus/core'
import { LIMITED_ACCESS_DENIED, LIMITED_ACCESS_EXPIRED } from '../protocol/limitedAccess.js'

/** Process-local, immutable operator policy. All identities here already passed Auth. */
export class LimitedAdmission {
  constructor(config, { now = Date.now, set = setTimeout, clear = clearTimeout } = {}) {
    this.config = config
    this.ids = new Set(config.testerIds)
    this.origins = new Set(config.origins)
    Object.assign(this, { now, set, clear })
    this.clients = new Set()
    this.timer = null
    this.closed = false
  }

  get expired() { return this.closed ||= this.now() >= this.config.expiresAt }

  request(options, origin) {
    if (this.expired) throw new ServerError(LIMITED_ACCESS_EXPIRED, 'limited access expired')
    if (!this.origins.has(origin) || options?.benchmark !== undefined) throw new ServerError(LIMITED_ACCESS_DENIED, 'limited access denied')
  }

  assert(auth, options, origin) {
    this.request(options, origin)
    if (auth?.kind !== 'player' || typeof auth.userId !== 'string' || !this.ids.has(auth.userId.toLowerCase())) {
      throw new ServerError(LIMITED_ACCESS_DENIED, 'limited access denied')
    }
  }

  track(client) {
    if (this.expired) { client.leave(LIMITED_ACCESS_EXPIRED); return }
    this.clients.add(client)
    if (this.timer === null) this.arm()
  }

  untrack(client) {
    this.clients.delete(client)
    if (!this.clients.size && this.timer !== null) { this.clear(this.timer); this.timer = null }
  }

  arm() {
    this.timer = this.set(() => {
      this.timer = null
      if (this.expired) this.closeExpired()
      else if (this.clients.size) this.arm()
    }, Math.max(1, Math.min(2 ** 31 - 1, this.config.expiresAt - this.now())))
    this.timer?.unref?.()
  }

  closeExpired() {
    if (!this.expired) return false
    for (const client of this.clients) client.leave(LIMITED_ACCESS_EXPIRED)
    this.clients.clear()
    if (this.timer !== null) { this.clear(this.timer); this.timer = null }
    return true
  }
}
