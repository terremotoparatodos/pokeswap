// Run with: deno test --allow-read supabase/functions/pokeswap-swap/
import {
  CORS_HEADERS,
  handleRetiredSwap,
  SWAP_RETIRED_CODE,
  SWAP_RETIRED_MESSAGE,
  type RetiredSwapDeps,
} from './handler.ts'

function expect(actual: unknown) {
  const show = (v: unknown) => JSON.stringify(v)
  return {
    toBe(expected: unknown) { if (actual !== expected) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    toEqual(expected: unknown) { if (show(actual) !== show(expected)) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    not: { toMatch(pattern: RegExp) { if (pattern.test(String(actual))) throw new Error(`did not expect ${pattern}`) } },
  }
}
const it = (name: string, fn: () => Promise<void>) => Deno.test(name, fn)
const describe = (_name: string, body: () => void) => body()

const VALID = 'valid-user-jwt'

function deps(tokens: string[] = []): RetiredSwapDeps {
  return { isAuthenticated: async token => { tokens.push(token); return token === VALID } }
}

const request = (init: { method?: string; token?: string | null; body?: string } = {}) => new Request('https://x/functions/v1/pokeswap-swap', {
  method: init.method ?? 'POST',
  headers: {
    'content-type': 'application/json',
    ...(init.token === null ? {} : { Authorization: `Bearer ${init.token ?? VALID}` }),
  },
  body: ['OPTIONS', 'GET', 'HEAD'].includes(init.method ?? 'POST') ? undefined : (init.body ?? '{}'),
})

function expectCors(res: Response) {
  for (const [name, value] of Object.entries(CORS_HEADERS)) expect(res.headers.get(name)).toBe(value)
}

/** Runs `fn` with fetch and every RNG source replaced by tripwires. */
async function withTripwires(fn: () => Promise<void>): Promise<string[]> {
  const tripped: string[] = []
  const fetch = globalThis.fetch
  const random = Math.random
  const getRandomValues = crypto.getRandomValues
  const randomUUID = crypto.randomUUID
  globalThis.fetch = ((input: unknown) => { tripped.push(`fetch ${String(input)}`); throw new Error('no network') }) as typeof fetch
  Math.random = () => { tripped.push('Math.random'); return 0 }
  crypto.getRandomValues = (<T>(a: T) => { tripped.push('getRandomValues'); return a }) as typeof crypto.getRandomValues
  crypto.randomUUID = (() => { tripped.push('randomUUID'); return '0-0-0-0-0' }) as typeof crypto.randomUUID
  try { await fn() } finally {
    globalThis.fetch = fetch
    Math.random = random
    crypto.getRandomValues = getRandomValues
    crypto.randomUUID = randomUUID
  }
  return tripped
}

describe('pokeswap-swap (retired)', () => {
  it('answers the CORS preflight without asking for auth', async () => {
    const tokens: string[] = []
    const res = await handleRetiredSwap(request({ method: 'OPTIONS', token: null }), deps(tokens))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expectCors(res)
    expect(tokens).toEqual([])
  })

  it('rejects a request without Authorization with 401, before any auth lookup', async () => {
    const tokens: string[] = []
    const res = await handleRetiredSwap(request({ token: null }), deps(tokens))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'No autorizado' })
    expectCors(res)
    expect(tokens).toEqual([])
  })

  it('rejects an invalid or anon token with 401 and never reveals the retirement', async () => {
    for (const token of ['forged', 'the-public-anon-key']) {
      const res = await handleRetiredSwap(request({ token }), deps())
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'No autorizado' })
      expectCors(res)
    }
  })

  it('fails closed with 500 when auth cannot be checked', async () => {
    const res = await handleRetiredSwap(request(), { isAuthenticated: () => Promise.reject(new Error('auth down')) })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Error interno' })
    expectCors(res)
  })

  it('answers an authenticated caller 410 swap_retired with the stable message', async () => {
    const tokens: string[] = []
    const res = await handleRetiredSwap(request(), deps(tokens))
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ code: SWAP_RETIRED_CODE, error: SWAP_RETIRED_MESSAGE, message: SWAP_RETIRED_MESSAGE })
    expect(res.headers.get('content-type')).toBe('application/json')
    expectCors(res)
    expect(tokens).toEqual([VALID])
  })

  it('keeps the public contract byte-for-byte', async () => {
    expect(SWAP_RETIRED_CODE).toBe('swap_retired')
    expect(SWAP_RETIRED_MESSAGE).toBe('El intercambio fue retirado. Próximamente podrás obtener Pokémon mediante huevos y captura.')
  })

  it('answers 410 whatever the body asks for, without reading it', async () => {
    for (const body of ['{"pokemon_given_id":25}', '{"pokemon_given_id":1,"pokemon_received_id":150}', 'not json', '']) {
      const req = request({ body })
      const res = await handleRetiredSwap(req, deps())
      expect(res.status).toBe(410)
      expect(req.bodyUsed).toBe(false)
    }
  })

  it('touches no network and rolls no RNG beyond the injected auth check, even when replayed', async () => {
    const tripped = await withTripwires(async () => {
      for (let i = 0; i < 5; i++) {
        for (const method of ['POST', 'GET', 'PUT', 'DELETE']) {
          const res = await handleRetiredSwap(request({ method, body: '{"pokemon_given_id":25}' }), deps())
          expect(res.status).toBe(410)
        }
      }
    })
    expect(tripped).toEqual([])
  })

  it('has no code path that could read or move ownership', async () => {
    // Comments may describe the old flow; the code may not contain it.
    const code = (file: string) => Deno.readTextFile(new URL(file, import.meta.url))
      .then(src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    for (const file of ['./handler.ts', './index.ts']) {
      const src = await code(file)
      for (const forbidden of [
        /\.from\(/, /\.rpc\(/, /\.upsert\(/, /\.insert\(/, /\.update\(/, /\.delete\(/,
        /SERVICE_ROLE/, /Math\.random/, /getRandomValues/, /randomUUID/,
        /\bslots\b/, /swap_history/, /swap_cooldown/, /pokemon_given_id/, /req\.json\(|\.text\(\)/,
      ]) expect(src).not.toMatch(forbidden)
    }
  })
})
