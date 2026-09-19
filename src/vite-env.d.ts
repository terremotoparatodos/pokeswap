/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_REALTIME_URL?: string
  /** `on` builds Community Playtest 0.1; anything else builds the normal product. */
  readonly VITE_PLAYTEST?: string
  /** Build-time fallback access code, used until the remote gate answers. */
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Short commit of this build, injected by vite.config.ts. */
declare const __PLAYTEST_COMMIT__: string
/** ISO timestamp of this build, injected by vite.config.ts. */
declare const __PLAYTEST_BUILT_AT__: string
