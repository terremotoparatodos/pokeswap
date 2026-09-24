import { execFileSync } from 'node:child_process'

/**
 * Bumped whenever presence behaviour that a client depends on changes, so a
 * deploy can be verified from the outside without the Colyseus dashboard.
 *   1 — R30 / Community Playtest 0.1 (26f3b7c and earlier)
 *   2 — area arrivals match the client (protocol/arrival.js); token-bucket
 *       move pacing; rejection reasons (replay vs rate); rate-refused
 *       sequences are consumed and answered with the unchanged actor;
 *       clients declaring `presenceProtocol: 2` get compact `step` deltas
 */
export const PRESENCE_PROTOCOL_REVISION = 2

const COMMIT = /^[0-9a-f]{7,40}$/

/** Short commit of the running build: env first, then git, else `unknown`. Never throws. */
export function resolveBuildCommit(env = process.env, git = () => execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString()) {
  for (const key of ['PRESENCE_BUILD_COMMIT', 'SOURCE_COMMIT', 'GIT_COMMIT', 'COMMIT_SHA']) {
    const value = String(env[key] ?? '').trim().toLowerCase()
    if (COMMIT.test(value)) return value.slice(0, 7)
  }
  try {
    const value = git().trim().toLowerCase()
    if (COMMIT.test(value)) return value.slice(0, 7)
  } catch { /* no git in the image: report unknown rather than fail boot */ }
  return 'unknown'
}

/** Public, non-sensitive build identity: no env values, hostnames, counts or user data. */
export function versionInfo({ commit, startedAt }) {
  return { service: 'pokeswap-presence', commit, protocol: PRESENCE_PROTOCOL_REVISION, startedAt }
}
