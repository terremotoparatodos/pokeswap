// kofi-webhook — donation receiver with no effects (PAYMENTS RETIRE-2).
//
// Ko-fi stays only as a voluntary donation with no in-game reward. The old
// handler logged the whole payload, looked players up by email or username
// with the service role, cleared `profiles.swap_cooldown_until` and wrote
// `kofi_payments`. Swap is retired, so that sold nothing, and nothing replaces
// it: no eggs, no tokens, no better odds.
//
// What is left: check that the call really comes from Ko-fi and answer 200 so
// Ko-fi stops retrying. There is no Supabase client, no service role, no
// table, no network and no dedupe (with no effects, a duplicate is harmless).
// Ko-fi keeps its own record of every donation.
//
// Logs are fixed strings. Nothing from the request (token, email, name,
// message, amount, body) is ever printed, before or after the token check.

export const KOFI_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

/** Ko-fi posts a small form (`data=<json>`); anything larger is not Ko-fi. */
export const KOFI_MAX_BODY_BYTES = 16 * 1024

export const KOFI_LOG = {
  notConfigured: 'kofi-webhook: not configured',
  rejected: 'kofi-webhook: rejected',
  acknowledged: 'kofi-webhook: acknowledged',
  failed: 'kofi-webhook: internal error',
} as const

export interface KofiWebhookDeps {
  /** The `KOFI_VERIFICATION_TOKEN` secret, or undefined when it is not set. */
  verificationToken(): string | undefined
}

const reply = (body: string, status: number) =>
  new Response(body, { status, headers: { ...KOFI_CORS_HEADERS, 'content-type': 'text/plain' } })

export async function handleKofiWebhook(req: Request, deps: KofiWebhookDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: KOFI_CORS_HEADERS })

  try {
    // Fail closed before touching the body: without the secret nothing can be verified.
    const expected = deps.verificationToken()
    if (!expected) {
      console.error(KOFI_LOG.notConfigured)
      return reply('unavailable', 503)
    }

    const received = await readVerificationToken(req)
    if (received === null || !(await sameSecret(received, expected))) {
      console.warn(KOFI_LOG.rejected)
      return reply('unauthorized', 401)
    }

    // Valid, ignored (not a public donation, a subscription, a shop order…) and
    // duplicate events all end here: none of them changes anything.
    console.log(KOFI_LOG.acknowledged)
    return reply('ok', 200)
  } catch {
    // Only reached on a bug in this file; the error itself could quote the request.
    console.error(KOFI_LOG.failed)
    return reply('error', 500)
  }
}

/**
 * The `verification_token` of Ko-fi's `data=<json>` form, or null when the body
 * is not that shape. A malformed or oversized body cannot carry a valid token,
 * so every parse failure means "not Ko-fi", not an error.
 */
async function readVerificationToken(req: Request): Promise<string | null> {
  const bytes = await readCapped(req, KOFI_MAX_BODY_BYTES)
  if (bytes === null) return null
  try {
    const form = await new Request('http://kofi.invalid/', {
      method: 'POST',
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
      body: bytes,
    }).formData()
    const data = form.get('data')
    if (typeof data !== 'string') return null
    const parsed: unknown = JSON.parse(data)
    if (typeof parsed !== 'object' || parsed === null) return null
    const token = (parsed as Record<string, unknown>).verification_token
    return typeof token === 'string' ? token : null
  } catch {
    return null
  }
}

async function readCapped(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (!Number.isFinite(declared) || declared > limit) return null
  if (!req.body) return null
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    // The sender dropped the connection mid-body: nothing to verify.
    return null
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Constant-time comparison. Both sides are hashed first, so the loop always
 * runs over 32 bytes and the time does not depend on where (or whether) the
 * tokens differ, nor on their lengths.
 */
async function sameSecret(received: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}
