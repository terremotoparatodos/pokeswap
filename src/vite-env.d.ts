/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_REALTIME_URL?: string
  /** `on` builds Community Playtest 0.1; anything else builds the normal product. */
  readonly VITE_PLAYTEST?: string
  /** Local-only renderer timing HUD without enabling the remote playtest gate. */
  readonly VITE_PERF?: string
  /** Makes this development browser a playable synthetic client in the local presence benchmark. */
  readonly VITE_PRESENCE_BENCHMARK?: string
  /** ECO-GAMEPLAY-1: 'on' in a DEVELOPMENT build only (src/features/world/domain/ecoExperiment.ts). */
  readonly VITE_ECO_EXPERIMENT?: string
  /** Build-time fallback access code, used until the remote gate answers. */
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Short commit of this build, injected by vite.config.ts. */
declare const __PLAYTEST_COMMIT__: string
/** ISO timestamp of this build, injected by vite.config.ts. */
declare const __PLAYTEST_BUILT_AT__: string
