// HEALTH PORT-1: one real realtime process, as PM2 runs it, for the multi-process tests
// (realtimeProcess.test.js). It reports its bootstrap trace, logs and ports over IPC and shuts
// down gracefully on 'shutdown'. Not a test file: node --test never runs it directly.
//
// The caller sets PORT, HEALTH_PORT and NODE_APP_INSTANCE, plus:
//   FIXTURE_CLOUD=1           the bootstrap sees COLYSEUS_CLOUD (the health-port rule of a Cloud
//                             slot). process.env does NOT get it: Colyseus would then listen on
//                             /run/colyseus/*.sock, which only exists on Cloud, so the game port
//                             stays TCP here.
//   FIXTURE_SIGINT_AT=<step>  a SIGINT arrives when the bootstrap traces <step>.
process.env.NODE_ENV = 'development'
process.env.WORLD_PLAYERDATA = 'pglite'
process.env.WORLD_WILD_CATALOG = 'synthetic'
process.env.WORLD_LOCATION_PERSISTENCE = 'shadow'
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable'

const report = message => process.send?.(message)
process.on('exit', code => report({ event: 'exit', code }))

const { startRealtimeServer } = await import('./realtimeServer.js')
const env = process.env.FIXTURE_CLOUD === '1' ? { ...process.env, COLYSEUS_CLOUD: 'fixture' } : process.env
const started = await startRealtimeServer({
  env,
  log: line => report({ event: 'log', line }),
  trace: (event, state) => {
    report({ event, state })
    if (event === process.env.FIXTURE_SIGINT_AT) process.emit('SIGINT')
  },
})
// Give an asynchronous bind error (an unhandled 'error' event before HEALTH PORT-1) the chance
// to surface first.
await new Promise(resolve => setTimeout(resolve, 200))
const { health, host } = started
const healthPort = health?.status === undefined ? health?.address?.()?.port ?? null // e09591a: a bare http.Server
  : health.status === 'listening' ? health.port : null
report({ event: 'started', hostState: host?.state ?? null, generation: host?.generation ?? null, healthPort, healthStatus: health?.status ?? null, interrupted: started.interrupted ?? null })
const heartbeat = setInterval(() => report({ event: 'alive', hostState: host?.state ?? null, generation: host?.generation ?? null }), 100)
process.on('message', message => {
  if (message !== 'shutdown') return
  clearInterval(heartbeat)
  void started.gameServer.gracefullyShutdown(true)
})
