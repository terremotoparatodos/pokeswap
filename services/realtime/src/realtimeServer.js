import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { PresenceRoom, flushLocationsForShutdown, preparePresenceHost } from './rooms/PresenceRoom.js'
import { BenchmarkPresenceRoom } from './rooms/BenchmarkPresenceRoom.js'
import { createHealthServer } from './observability/health.js'
import { metrics } from './observability/metrics.js'
import { originPolicy } from './security/originPolicy.js'
import { resolveBuildCommit, versionInfo } from './observability/version.js'

// WORLD LOCATION-2: on a graceful shutdown Colyseus first disconnects every
// client (each onLeave marks its location urgent), then calls onShutdown: a
// final save within SHUTDOWN_LOCATION_FLUSH_MS, best effort, never relied on.
export const SHUTDOWN_LOCATION_FLUSH_MS = 3_000

/**
 * The realtime process: one Colyseus server with the presence room, its public
 * /version and the internal health port.
 *
 * WORLD LOCATION-4 lifecycle (docs/design/WORLD_LOCATION_4_DESIGN.md §3.3.2), only when
 * location persistence is shadow/on with a store that supports it:
 *   1. acquire a generation BEFORE listen: the host is 'starting' (owns nothing);
 *   2. define the room and listen (on Colyseus Cloud, @colyseus/tools reports 'ready'
 *      to PM2 inside listen);
 *   3. activate right after listen resolves: only now do sessions get keys; joins that
 *      arrive in between wait for it (ACTIVATION_WAIT_MS, then 4503).
 * With location off nothing is acquired and the process starts exactly as before.
 */
export async function startRealtimeServer({ env = process.env, port = Number(env.PORT ?? 2567), healthPort = Number(env.HEALTH_PORT ?? port + 1), log = message => console.log(message), trace = () => {} } = {}) {
  const benchmarkMode = env.PRESENCE_BENCHMARK === 'on' && env.NODE_ENV !== 'production'
  const productionOriginPolicy = originPolicy(env)
  const beforeUpgrade = benchmarkMode
    ? request => request.headers.get('origin') ? productionOriginPolicy(request) : undefined
    : productionOriginPolicy
  const version = versionInfo({ commit: resolveBuildCommit(env), startedAt: new Date().toISOString() })
  const gameServer = new Server({
    transport: new WebSocketTransport({ beforeUpgrade }),
    // Public build identity so a deploy can be verified without the Cloud
    // dashboard. Aggregate metrics stay on the internal health port.
    express: app => { app.get('/version', (_request, response) => { response.set('cache-control', 'no-store').json(version) }) },
  })
  gameServer.define('presence', benchmarkMode ? BenchmarkPresenceRoom : PresenceRoom)
  const host = benchmarkMode ? null : await preparePresenceHost()
  trace('acquired', host?.state ?? null)
  gameServer.onShutdown(async () => {
    const { sent, left, timedOut } = await flushLocationsForShutdown(SHUTDOWN_LOCATION_FLUSH_MS)
    if (sent || left) log(`[location] shutdown flush: ${sent} saved, ${left} not saved${timedOut ? ' (deadline reached)' : ''}`)
    await host?.stop()
  })
  await gameServer.listen(port)
  trace('listening', host?.state ?? null)
  await host?.activate()
  trace('activated', host?.state ?? null)
  const health = createHealthServer({
    port: healthPort, metrics, version,
    ready: () => Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) && (!host || host.admitting),
  })
  return { gameServer, host, health, version }
}
