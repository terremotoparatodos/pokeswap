import { ServerError } from '@colyseus/core'
import { authenticateSupabase } from '../auth/supabaseAuth.js'
import { LIMITED_ACCESS_DENIED } from '../protocol/limitedAccess.js'

/** One bounded policy wrapper; normal PresenceRoom and its game rules remain authoritative. */
export function limitedPresenceRoom(PresenceRoom, admission, env) {
  const verified = new WeakSet()
  return class LimitedPresenceRoom extends PresenceRoom {
    // Static Auth also protects HTTP matchmaking before a room/seat is created.
    static async onAuth(_token, options, context) {
      const origin = context?.headers?.get('origin')
      admission.request(options, origin)
      const auth = await authenticateSupabase(options?.token, env)
      admission.assert(auth, options, origin) // recheck after an asynchronous Auth response
      const result = { ...auth, token: options?.token ?? null, limitedOrigin: origin }
      verified.add(result)
      return result
    }

    assertAdmission(_client, options, auth) {
      if (!verified.has(auth)) throw new ServerError(LIMITED_ACCESS_DENIED, 'limited access denied')
      admission.assert(auth, options, auth.limitedOrigin)
    }

    async onJoin(client, options, auth) {
      this.assertAdmission(client, options, auth)
      await super.onJoin(client, options, auth)
      admission.track(client)
    }

    onMessage(type, callback) {
      return super.onMessage(type, (...args) => {
        if (admission.closeExpired()) return
        return callback(...args)
      })
    }

    // Pending owned reads must not reserve a battle after the window closed.
    sessionAllowed(client) { return Boolean(client) && !admission.expired }

    onLeave(client) { admission.untrack(client); return super.onLeave(client) }
  }
}
