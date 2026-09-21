import { ServerError } from '@colyseus/core'
import { PresenceRoom } from './PresenceRoom.js'

const BENCHMARK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const BENCHMARK_AREAS = new Set(['ciudad-corazon', 'pradera'])

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
    if (auth.kind === 'player' && area && area !== 'ciudad-corazon') this.changeArea(client, { areaId: area })
  }
}
