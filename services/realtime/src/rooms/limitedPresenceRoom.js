import { ServerError } from '@colyseus/core'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { authenticateSupabase } from '../auth/supabaseAuth.js'
import { LIMITED_ACCESS_DENIED, LIMITED_ACCESS_EXPIRED } from '../protocol/limitedAccess.js'

/** One bounded policy wrapper; normal PresenceRoom and its game rules remain authoritative. */
export function limitedPresenceRoom(PresenceRoom, admission, env) {
  // Colyseus serializes static Auth data between matchmaking and the room.
  // Bind that private envelope to this process; object identity cannot survive it.
  const key = randomBytes(32)
  const proof = auth => createHmac('sha256', key).update(JSON.stringify([auth.kind, auth.userId, auth.username, auth.token, auth.limitedOrigin])).digest('hex')
  return class LimitedPresenceRoom extends PresenceRoom {
    // Static Auth also protects HTTP matchmaking before a room/seat is created.
    static async onAuth(_token, options, context) {
      try {
        const origin = context?.headers?.get('origin')
        admission.request(options, origin)
        const auth = await authenticateSupabase(options?.token, env)
        admission.assert(auth, options, origin) // recheck after an asynchronous Auth response
        const result = { ...auth, token: options?.token ?? null, limitedOrigin: origin }
        return { ...result, limitedProof: proof(result) }
      } catch (error) {
        // This Colyseus router uses error.code as the HTTP status. WebSocket
        // close codes cannot be returned here; the limited client maps 403/410.
        if (error?.code === LIMITED_ACCESS_DENIED) throw new ServerError(403, 'limited access denied')
        if (error?.code === LIMITED_ACCESS_EXPIRED) throw new ServerError(410, 'limited access expired')
        throw new ServerError(503, 'limited authentication unavailable')
      }
    }

    assertAdmission(_client, options, auth) {
      if (typeof auth?.limitedProof !== 'string' || !/^[a-f0-9]{64}$/.test(auth.limitedProof)
        || !timingSafeEqual(Buffer.from(auth.limitedProof, 'hex'), Buffer.from(proof(auth), 'hex'))) throw new ServerError(LIMITED_ACCESS_DENIED, 'limited access denied')
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
