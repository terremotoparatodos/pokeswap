import { ServerError } from '@colyseus/core'
import { PresenceRoom, liveActorForTesting } from './PresenceRoom.js'
import { nextHop, portalTo } from '../world/navigation.js'

const BENCHMARK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const BENCHMARK_AREAS = new Set(['ciudad-corazon', 'pradera', 'cueva-inicial'])

/**
 * Local-only room used by the reproducible multiplayer benchmark.
 *
 * The production entrypoint refuses to register this class when NODE_ENV is
 * production. Normal browser guests still use the real auth path; only the
 * synthetic clients carrying a tightly validated benchmark identity bypass
 * Supabase so the test needs no throwaway accounts.
 */
export class BenchmarkPresenceRoom extends PresenceRoom {
  async onAuth(client, options) {
    const identity = options?.benchmark
    if (!identity) return super.onAuth(client, options)
    if (!BENCHMARK_ID.test(identity.id) || typeof identity.username !== 'string' ||
      (identity.area !== undefined && !BENCHMARK_AREAS.has(identity.area))) {
      throw new ServerError(4000, 'invalid benchmark identity')
    }
    return {
      kind: 'player',
      userId: `benchmark-${identity.id}`,
      username: identity.username.slice(0, 40),
      token: null,
    }
  }

  async onJoin(client, options, auth) {
    await super.onJoin(client, options, auth)
    const area = options?.benchmark?.area
    if (auth.kind !== 'player' || !area) return
    // CAVES-4: areas change only through a portal, for synthetic players too.
    // Stand the actor on each portal on the way (a server-made move) and ask
    // for the next area like a client would, so the service's rules decide.
    const actor = liveActorForTesting(auth.userId)
    for (let hops = 0; actor && actor.areaId !== area && hops < 3; hops++) {
      const portal = portalTo(actor.areaId, nextHop(actor.areaId, area))
      if (!portal) return
      this.placeActor(actor, { tx: portal.tx, ty: portal.ty, dir: actor.dir })
      this.changeArea(client, { areaId: portal.to })
    }
  }
}
