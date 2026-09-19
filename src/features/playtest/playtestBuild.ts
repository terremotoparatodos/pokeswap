// The impure edge of the playtest feature: what this particular build is.
//
// Everything else in `playtest/domain` is pure and takes these as arguments,
// so the rules can be tested without a bundler.

import { createBuildIdentity, type BuildIdentity } from './domain/buildIdentity'
import { BUILD_DEFAULT_GATE, type PlaytestGateConfig, type PlaytestMode } from './domain/playtestGate'

/** `on` is the only value that builds a playtest. Anything else is the normal product. */
export const PLAYTEST_MODE: PlaytestMode = import.meta.env.VITE_PLAYTEST === 'on' ? 'on' : 'off'

/**
 * The one import the rest of the app asks. Written as a constant so a bundler
 * can fold it: with the flag off, every playtest surface is dead code and is
 * dropped from the bundle exactly the way the DEV-only routes already are.
 */
export const isPlaytest: boolean = PLAYTEST_MODE === 'on'

export const BUILD: BuildIdentity = createBuildIdentity(__PLAYTEST_COMMIT__, __PLAYTEST_BUILT_AT__)

/** What the gate is until (and unless) the remote row answers. */
export const buildDefaultGate = (): PlaytestGateConfig => ({
  ...BUILD_DEFAULT_GATE,
  accessCode: import.meta.env.VITE_PLAYTEST_CODE?.trim() || null,
})
