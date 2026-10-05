// HEALTH PORT-1 (docs/design/world-location-4/evidence/6-cloud-topology.md §4.3): which TCP port
// the internal health server takes.
//
// - Local / Docker (no COLYSEUS_CLOUD): HEALTH_PORT, else PORT + 1 (2568 by default). One process
//   per port, exactly as before; NODE_APP_INSTANCE is not used, so no formula can land on the game
//   port of another local realtime.
// - Colyseus Cloud (COLYSEUS_CLOUD defined): HEALTH_PORT (or PORT + 1, 2568 by default) is the
//   BASE and each PM2 slot adds its NODE_APP_INSTANCE (absent = 0). During a rollout the old and
//   the new process run at once in slots 0 and 1, so they take base and base + 1. Their game
//   ports never use TCP there (@colyseus/tools listens on /run/colyseus/<2567 + slot>.sock).
//
// Any malformed value is a configuration error, thrown before the process acquires anything.

export const DEFAULT_GAME_PORT = 2567

export class PortConfigError extends Error {
  constructor(message) { super(message); this.name = 'PortConfigError' }
}

function decimal(name, raw) {
  const text = String(raw)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new PortConfigError(`${name} must be a non-negative integer, got ${JSON.stringify(text)}`)
  return Number(text)
}

function tcpPort(name, value) {
  if (value < 1 || value > 65535) throw new PortConfigError(`${name} must be between 1 and 65535, got ${value}`)
  return value
}

/** The game port: PORT, else 2567. */
export function resolveGamePort(env = {}) {
  return env.PORT === undefined ? DEFAULT_GAME_PORT : tcpPort('PORT', decimal('PORT', env.PORT))
}

/** { port, base, instance } — instance is null outside Colyseus Cloud. Throws PortConfigError. */
export function resolveHealthPort(env = {}, gamePort = resolveGamePort(env)) {
  const base = env.HEALTH_PORT === undefined
    ? tcpPort('PORT + 1 (health port)', gamePort + 1)
    : tcpPort('HEALTH_PORT', decimal('HEALTH_PORT', env.HEALTH_PORT))
  if (env.COLYSEUS_CLOUD === undefined) return { port: base, base, instance: null }
  const instance = env.NODE_APP_INSTANCE === undefined ? 0 : decimal('NODE_APP_INSTANCE', env.NODE_APP_INSTANCE)
  return { port: tcpPort(`health port (base ${base} + NODE_APP_INSTANCE ${instance})`, base + instance), base, instance }
}
