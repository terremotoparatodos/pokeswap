/** Rejects recognizable private Supabase content; never includes the value in errors. */
export function assertPublicSupabaseKey(value: string | undefined, field: string): void
