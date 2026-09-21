import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { PresenceRoom } from './rooms/PresenceRoom.js'
import { BenchmarkPresenceRoom } from './rooms/BenchmarkPresenceRoom.js'
import { createHealthServer } from './observability/health.js'
import { metrics } from './observability/metrics.js'
import { originPolicy } from './security/originPolicy.js'

const port = Number(process.env.PORT ?? 2567)
const benchmarkMode = process.env.PRESENCE_BENCHMARK === 'on' && process.env.NODE_ENV !== 'production'
const productionOriginPolicy = originPolicy(process.env)
const beforeUpgrade = benchmarkMode
  ? request => request.headers.get('origin') ? productionOriginPolicy(request) : undefined
  : productionOriginPolicy
const gameServer = new Server({ transport: new WebSocketTransport({ beforeUpgrade }) })
gameServer.define('presence', benchmarkMode ? BenchmarkPresenceRoom : PresenceRoom)
await gameServer.listen(port)
createHealthServer({ port: Number(process.env.HEALTH_PORT ?? port + 1), metrics, ready: () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) })
