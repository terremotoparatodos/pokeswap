// Who this build is, in one line a player can read out loud.
//
// Every bug report carries it, because "no me anda" is worth very little when
// four builds went out during the stream. The commit is short and the version
// is fixed for this playtest; nothing here is derived from the session, so it
// is safe to show and safe to copy.

export const PLAYTEST_VERSION = 'Community Playtest 0.2'

export interface BuildIdentity {
  readonly version: string
  /** Short commit hash, or `unknown` when the build had no git available. */
  readonly commit: string
  /** ISO timestamp of the build. */
  readonly builtAt: string
}

/** `Community Playtest 0.2 · a1b2c3d` — what the banner and the reports show. */
export const buildLabel = (build: BuildIdentity): string => `${build.version} · ${build.commit}`

export function createBuildIdentity(commit: unknown, builtAt: unknown): BuildIdentity {
  return {
    version: PLAYTEST_VERSION,
    commit: typeof commit === 'string' && commit.trim() ? commit.trim() : 'unknown',
    builtAt: typeof builtAt === 'string' && builtAt.trim() ? builtAt.trim() : 'unknown',
  }
}
