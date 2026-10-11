function declaresServiceRole(value) {
  const parts = value.split('.')
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+={0,2}$/.test(parts[1])) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    // An undecodable payload is not a recognizable service-role JWT.
    // Format/credential validity remains the responsibility of existing checks.
    return false
  }
}

/** Configuration guard only, not authentication or a detector of arbitrary secrets.
 * Recognizes private Supabase key shapes by content, independent of the field name.
 * No signature verification: even a fictitious service-role JWT must not be shipped.
 */
export function assertPublicSupabaseKey(value, field) {
  if (typeof value !== 'string') return
  const candidate = value.trim()
  if (candidate.startsWith('sb_secret_') || declaresServiceRole(candidate)) {
    throw new Error(`Recognizable private Supabase key in public configuration: ${field}`)
  }
}
