import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { PresenceRoom, beginPresenceShutdown, drainPresence, flushLocationsForShutdown, preparePresenceHost, presenceServing, stopPresenceHosting } from './rooms/PresenceRoom.js'
import { shutdownFlushLine } from './presence/shutdownSummary.js'
import { BenchmarkPresenceRoom } from './rooms/BenchmarkPresenceRoom.js'
import { startHealthServer } from './observability/health.js'
import { resolveGamePort, resolveHealthPort } from './observability/healthPort.js'
import { metrics } from './observability/metrics.js'
import { originPolicy } from './security/originPolicy.js'
import { resolveBuildCommit, versionInfo } from './observability/version.js'

// WORLD LOCATION-4: on a graceful shutdown Colyseus calls onBeforeShutdown BEFORE it
// disconnects anyone: the process drains there (refuses joins, freezes movement, host →
// draining, saves every pending location within SHUTDOWN_LOCATION_FLUSH_MS); then the room
// closes every socket with 4503 (PresenceRoom.onBeforeShutdown); onShutdown flushes whatever a
// disconnect still marked (normally nothing: movement was frozen) and stops the host.
export const SHUTDOWN_LOCATION_FLUSH_MS = 3_000

/**
 * The realtime process: one Colyseus server with the presence room, its public
 * /version and the internal health port.
 *
 * Bootstrap order (WORLD LOCATION-4, docs/design/WORLD_LOCATION_4_DESIGN.md §3.3.2, and
 * HEALTH PORT-1, docs/design/world-location-4/evidence/6-cloud-topology.md §4.3):
 *   0. resolve the ports: a malformed PORT / HEALTH_PORT / NODE_APP_INSTANCE throws here,
 *      before anything is bound or acquired (observability/healthPort.js);
 *   1. bind the health server and wait for its single outcome: 'listening' or 'unavailable'.
 *      A bind failure is logged and NEVER fatal, so it can no longer kill the process after
 *      activate() and burn a generation; /readyz answers 503 until step 4 finishes;
 *   2. acquire a generation BEFORE listen (only when location persistence is shadow/on with a
 *      store that supports it): the host is 'starting' (owns nothing);
 *   3. define the room and listen (on Colyseus Cloud, @colyseus/tools reports 'ready' to PM2
 *      inside listen);
 *   4. activate right after listen resolves: only now do sessions get keys; joins that arrive
 *      in between wait for it (ACTIVATION_WAIT_MS, then 4503).
 * A shutdown (SIGINT/SIGTERM) that lands during steps 1–3 stops the bootstrap there: no later
 * acquire, listen or activate. With location off nothing is acquired and the process starts
 * exactly as before.
 */
export async function startRealtimeServer({ env = process.env, port, healthPort, log = message => console.log(message), trace = () => {} } = {}) {
  const gamePort = port ?? resolveGamePort(env)
  const healthPortToBind = healthPort ?? resolveHealthPort(env, gamePort).port
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
  let host = null
  let health = null
  let drained = null
  let shuttingDown = false
  let bootstrapped = false
  gameServer.onBeforeShutdown(async () => {
    shuttingDown = true
    // CLOUD READINESS-3: synchronously, before anything awaits: no standby or promotion from now on.
    beginPresenceShutdown()
    drained = await drainPresence({ deadlineMs: SHUTDOWN_LOCATION_FLUSH_MS })
  })
  // A host displaced by the authority (activation refused, a newer host, an expired lease) does
  // NOT end the process (review F1): it stays stopped, /readyz 503, until its deploy or
  // supervisor ends it. Only a real shutdown (SIGTERM/SIGINT) exits, through Colyseus.
  gameServer.onShutdown(async () => {
    shuttingDown = true
    const late = await flushLocationsForShutdown(SHUTDOWN_LOCATION_FLUSH_MS)
    const line = shutdownFlushLine(drained, late)
    if (line) log(line)
    await host?.stop()
    // A host this process promoted from standby (CLOUD READINESS-3) is not `host`: stop it too.
    await stopPresenceHosting()
    await health?.close()
  })
  // A bootstrap interrupted by a shutdown: release what it took and go no further.
  const interrupted = async step => {
    trace('interrupted', step)
    await host?.stop()
    await health?.close()
    return { gameServer, host, health, version, interrupted: step }
  }

  health = await startHealthServer({
    port: healthPortToBind, metrics, version, log,
    ready: () => bootstrapped && Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) && presenceServing(),
  })
  trace('health', health.status)
  if (shuttingDown) return interrupted('health')
  host = benchmarkMode ? null : await preparePresenceHost()
  trace('acquired', host?.state ?? null)
  if (shuttingDown) return interrupted('acquired')
  await gameServer.listen(gamePort)
  trace('listening', host?.state ?? null)
  if (shuttingDown) return interrupted('listening')
  await host?.activate()
  trace('activated', host?.state ?? null)
  bootstrapped = true
  return { gameServer, host, health, version }
}
