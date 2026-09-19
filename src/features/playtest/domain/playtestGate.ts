// The gate that opens and closes Community Playtest 0.1.
//
// Two independent switches, deliberately layered, because they fail in
// different directions:
//
//   1. the **build flag** (`VITE_PLAYTEST`): decides whether this bundle is a
//      playtest build at all. Flipping it needs a redeploy, and that is the
//      point — a normal production build cannot accidentally become a playtest.
//   2. the **remote gate**: a row the operator can flip in seconds without a
//      redeploy, to close the playtest the moment the stream ends.
//
// The remote gate can only *narrow*. It can close a build that shipped open;
// it can never open a build that did not ship as a playtest build. So the worst
// case of the network layer failing is the build-time default, never more.
//
// PLAYTEST ONLY. Nothing here is a security boundary — see §Honestidad in
// docs/playtest/COMMUNITY_PLAYTEST_0_1.md. The access code lives in a public
// bundle or in a public row; it is a speed bump against a stray link, not auth.
// What actually protects the player is that a playtest build reaches no
// persistent state at all.

/** What the build itself declares. */
export type PlaytestMode = 'off' | 'on'

/** Operator-controlled configuration, from the remote row or the build default. */
export interface PlaytestGateConfig {
  readonly state: 'open' | 'closed'
  /** Shown to the player when closed. Null uses the default sentence. */
  readonly message: string | null
  /** Null means no code is required. */
  readonly accessCode: string | null
}

export type PlaytestAccess =
  /** Not a playtest build: the normal product runs, untouched. */
  | { readonly status: 'off' }
  /** The remote gate has not answered yet. */
  | { readonly status: 'checking' }
  /** Closed: nobody plays. */
  | { readonly status: 'closed'; readonly message: string }
  /** Open, but this visitor has not entered the code. */
  | { readonly status: 'locked'; readonly wrongCode: boolean }
  | { readonly status: 'open' }

export const DEFAULT_CLOSED_MESSAGE =
  'El Community Playtest 0.1 está cerrado. ¡Gracias por jugar! Volvé a probar en la próxima ventana.'

/** The build-time default, used until (and if) the remote gate answers. */
export const BUILD_DEFAULT_GATE: PlaytestGateConfig = {
  state: 'open',
  message: null,
  accessCode: null,
}

/**
 * Codes are compared case-insensitively and without surrounding blanks: the
 * player is typing something read out loud on a stream, not a password.
 */
export const normalizeCode = (value: string): string => value.trim().toLowerCase()

export const codeMatches = (expected: string | null, submitted: string | null): boolean =>
  expected === null || (submitted !== null && normalizeCode(expected) === normalizeCode(submitted))

export interface AccessInput {
  readonly mode: PlaytestMode
  /** Null while the remote gate is still being read. */
  readonly config: PlaytestGateConfig | null
  /** What this visitor has already entered, if anything. */
  readonly submittedCode: string | null
  /** True once a submitted code has been rejected, so the form can say so. */
  readonly wrongCode?: boolean
}

export function resolveAccess({ mode, config, submittedCode, wrongCode = false }: AccessInput): PlaytestAccess {
  if (mode === 'off') return { status: 'off' }
  if (!config) return { status: 'checking' }
  if (config.state === 'closed') return { status: 'closed', message: config.message ?? DEFAULT_CLOSED_MESSAGE }
  if (!codeMatches(config.accessCode, submittedCode)) return { status: 'locked', wrongCode }
  return { status: 'open' }
}

/**
 * Reads a gate row that came off the network. Anything malformed falls back to
 * the build default rather than throwing: a typo in a row must not take the
 * playtest down mid-stream.
 */
export function parseGateConfig(row: unknown, fallback: PlaytestGateConfig = BUILD_DEFAULT_GATE): PlaytestGateConfig {
  if (!row || typeof row !== 'object') return fallback
  const record = row as Record<string, unknown>
  const state = record.state === 'closed' ? 'closed' : record.state === 'open' ? 'open' : fallback.state
  const message = typeof record.message === 'string' && record.message.trim() ? record.message.trim() : null
  const rawCode = record.access_code ?? record.accessCode
  const accessCode = typeof rawCode === 'string' && rawCode.trim() ? rawCode.trim() : null
  return { state, message, accessCode }
}
