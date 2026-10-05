// CLOUD ENV-1 test fixture (see cloudEnvironment.hooks.mjs): stands in for realtimeServer.js in
// child processes. Its static imports are the modules that capture the environment when they are
// evaluated, exactly as realtimeServer.js imports them; `captured` is read at that same moment.
// The report never contains a secret: only whether one is set and its SHA-256.
import { createHash } from 'node:crypto'
import { metrics } from './observability/metrics.js'
import './rooms/PresenceRoom.js'

const env = process.env
const captured = {
  NODE_ENV: env.NODE_ENV ?? null,
  WORLD_LOCATION_PERSISTENCE: env.WORLD_LOCATION_PERSISTENCE ?? null,
  WORLD_AUTHORITY_URL: env.WORLD_AUTHORITY_URL ?? null,
  ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? null,
  CLOUD_ENV_TEST_MARKER: env.CLOUD_ENV_TEST_MARKER ?? null,
  secretSha256: env.WORLD_AUTHORITY_SECRET ? createHash('sha256').update(env.WORLD_AUTHORITY_SECRET).digest('hex') : null,
}

export async function startRealtimeServer() {
  const location = metrics.location?.() ?? null
  const world = metrics.world?.() ?? null
  console.log(`CLOUD_ENV_PROBE ${JSON.stringify({
    captured,
    location: location && { mode: location.mode, effective: location.effective },
    // Non-null only when the world was built on the authority adapter (WORLD_AUTHORITY_*).
    worldAuthority: Boolean(world?.playerData),
  })}`)
  process.exit(0)
}
