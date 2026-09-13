// Allowed: 3–24 chars, letters, numbers, underscore, hyphen.
// Rendered as textContent only — never trusted HTML (INV-ID-4).

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username)
}

export function validateUsername(username: string): string | null {
  if (username.length < 3) return 'El nombre de usuario necesita al menos 3 caracteres'
  if (username.length > 24) return 'El nombre de usuario puede tener hasta 24 caracteres'
  if (!USERNAME_RE.test(username)) return 'Solo se permiten letras, números, _ y -'
  return null
}

// Normalize input: strip chars not in the allowed set, cap at 24.
export function normalizeUsernameInput(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
}
