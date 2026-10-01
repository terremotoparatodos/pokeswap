// Run with: deno test --allow-read --allow-write --allow-env --allow-net=127.0.0.1 supabase/functions/free-claim/
import {
  CORS_HEADERS,
  FREE_CLAIM_RETIRED_CODE,
  FREE_CLAIM_RETIRED_MESSAGE,
  handleRetiredFreeClaim,
  type RetiredFreeClaimDeps,
} from './handler.ts'
import { describe, expect, it, stripComments, violations } from '../_shared/webhookTestKit.ts'

const VALID = 'valid-user-jwt'
const HANDLER_URL = new URL('./handler.ts', import.meta.url)
const INDEX_URL = new URL('./index.ts', import.meta.url)

type Handler = (req: Request, deps: RetiredFreeClaimDeps) => Promise<Response>

function deps(tokens: string[] = []): RetiredFreeClaimDeps {
  return { isAuthenticated: token => { tokens.push(token); return Promise.resolve(token === VALID) } }
}

const request = (init: { method?: string; auth?: string | null; body?: string } = {}) => {
  const method = init.method ?? 'POST'
  return new Request('https://x/functions/v1/free-claim', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(init.auth === null ? {} : { Authorization: init.auth ?? `Bearer ${VALID}` }),
    },
    body: ['OPTIONS', 'GET', 'HEAD'].includes(method) ? undefined : (init.body ?? '{"pokemon_id":25}'),
  })
}

// What the old free-claim accepted, plus garbage. None of it may change the answer.
const BODIES = ['{"pokemon_id":25}', '{"pokemon_id":150,"is_free":true}', '{"pokemon_id":-1}', 'not json', '', 'x'.repeat(256 * 1024)]

function expectCors(res: Response) {
  for (const [name, value] of Object.entries(CORS_HEADERS)) expect(res.headers.get(name)).toBe(value)
}

async function fingerprint(res: Response) {
  return JSON.stringify({ status: res.status, body: await res.text(), headers: [...res.headers.entries()] })
}

/** Runs `fn` with network, RNG, env and files replaced by tripwires. */
async function withTripwires(fn: () => Promise<void>): Promise<string[]> {
  const tripped: string[] = []
  const saved = { fetch: globalThis.fetch, random: Math.random, envGet: Deno.env.get, readTextFile: Deno.readTextFile }
  globalThis.fetch = ((input: unknown) => { tripped.push(`fetch ${String(input)}`); throw new Error('no network') }) as typeof fetch
  Math.random = () => { tripped.push('Math.random'); return 0 }
  Deno.env.get = (name: string) => { tripped.push(`env ${name}`); return undefined }
  Deno.readTextFile = ((p: string | URL) => { tripped.push(`read ${String(p)}`); throw new Error('no files') }) as typeof Deno.readTextFile
  try { await fn() } finally {
    globalThis.fetch = saved.fetch
    Math.random = saved.random
    Deno.env.get = saved.envGet
    Deno.readTextFile = saved.readTextFile
  }
  return tripped
}

/**
 * The behavioral contract. Each check throws on the first violation, so a
 * mutant handler can be run through the same checks and must fail at least one.
 */
const CONTRACT: Array<[string, (handle: Handler) => Promise<void>]> = [
  ['OPTIONS answers the preflight without asking for auth', async handle => {
    const tokens: string[] = []
    const res = await handle(request({ method: 'OPTIONS', auth: null }), deps(tokens))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expectCors(res)
    expect(tokens).toEqual([])
  }],
  ['no Authorization, or not a Bearer token: 401 before any auth lookup', async handle => {
    for (const auth of [null, '', 'Bearer', 'Bearer ', 'Basic dXNlcjpwYXNz', VALID]) {
      const tokens: string[] = []
      const res = await handle(request({ auth }), deps(tokens))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'No autorizado' })
      expectCors(res)
      expect(tokens).toEqual([])
    }
  }],
  ['an invalid, forged or anon token: 401, and the retirement is not revealed', async handle => {
    for (const token of ['forged', 'the-public-anon-key', 'eyJhbGciOiJub25lIn0.e30.']) {
      const res = await handle(request({ auth: `Bearer ${token}` }), deps())
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'No autorizado' })
      expectCors(res)
    }
  }],
  ['auth that cannot be checked fails closed with a generic 500', async handle => {
    const res = await handle(request(), { isAuthenticated: () => Promise.reject(new Error('auth down: secret-detail')) })
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({ error: 'Error interno' })
    expect(body).not.toMatch(/secret-detail|auth down/)
    expectCors(res)
  }],
  ['a valid user gets 410 free_claim_retired with the stable message', async handle => {
    const tokens: string[] = []
    const res = await handle(request(), deps(tokens))
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ code: FREE_CLAIM_RETIRED_CODE, error: FREE_CLAIM_RETIRED_MESSAGE, message: FREE_CLAIM_RETIRED_MESSAGE })
    expect(res.headers.get('content-type')).toBe('application/json')
    expectCors(res)
    expect(tokens).toEqual([VALID])
  }],
  ['every body and method gets the same 410, and the body is never read', async handle => {
    const baseline = await fingerprint(await handle(request(), deps()))
    for (const body of BODIES) {
      const req = request({ body })
      expect(await fingerprint(await handle(req, deps()))).toBe(baseline)
      expect(req.bodyUsed).toBe(false)
    }
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const req = request({ method, body: '{"pokemon_id":25}' })
      expect(await fingerprint(await handle(req, deps()))).toBe(baseline)
      expect(req.bodyUsed).toBe(false)
    }
  }],
  ['repeated calls always close the same way, touching no network, env, file or RNG', async handle => {
    const seen = new Set<string>()
    const tripped = await withTripwires(async () => {
      for (let i = 0; i < 20; i++) {
        seen.add(await fingerprint(await handle(request(), deps())))
        seen.add(await fingerprint(await handle(request({ auth: 'Bearer forged' }), deps())))
      }
    })
    expect(tripped).toEqual([])
    expect(seen.size).toBe(2)
  }],
]

describe('free-claim (retired): behavior', () => {
  for (const [name, check] of CONTRACT) it(`free-claim: ${name}`, () => check(handleRetiredFreeClaim))

  // deno-lint-ignore require-await
  it('free-claim: keeps the public contract byte-for-byte', async () => {
    expect(FREE_CLAIM_RETIRED_CODE).toBe('free_claim_retired')
    expect(FREE_CLAIM_RETIRED_MESSAGE).toBe('El reclamo gratuito fue retirado. Próximamente podrás obtener Pokémon mediante huevos y captura.')
  })
})

// ── Source rules ────────────────────────────────────────────────────────────

/** Code the retired free-claim may not contain, in handler.ts or index.ts. */
const FORBIDDEN_IN_FREE_CLAIM: ReadonlyArray<RegExp> = [
  /SERVICE_ROLE|service_role|serviceClient|SUPABASE_DB_URL/i,
  /claim_slot|reset_daily_free_claim|confirm_payment/,
  /\.from\(|\.rpc\(|\.(insert|update|upsert|delete|select)\(|\.schema\(/,
  /auth\.admin|listUsers/,
  /\bslots\b|\bprofiles\b|free_claims_remaining|free_claim_last_reset|\btransactions\b|token_ledger|activity_feed|owner_id/,
  /\.(json|text|formData|arrayBuffer|blob|bytes)\(\)|\.body\b|getReader/,
  /Math\.random|getRandomValues|randomUUID/,
  /\bimport\(|Deno\.(readFile|readTextFile|writeFile|writeTextFile|open|Command|run)\b/,
]
/** handler.ts additionally has no network, env and no imports at all. */
const FORBIDDEN_IN_HANDLER: ReadonlyArray<RegExp> = [
  /\bfetch\(|Deno\.connect|WebSocket|XMLHttpRequest|createClient|@supabase/,
  /Deno\.env/,
  /^\s*import\s/m,
]

describe('free-claim (retired): source', () => {
  it('free-claim: handler.ts has no import, network, env, body read, RNG or database', async () => {
    const code = stripComments(await Deno.readTextFile(HANDLER_URL))
    expect(violations(code, [...FORBIDDEN_IN_FREE_CLAIM, ...FORBIDDEN_IN_HANDLER])).toEqual([])
  })

  it('free-claim: index.ts imports only the handler and supabase-js, reads only the URL and anon key', async () => {
    const code = stripComments(await Deno.readTextFile(INDEX_URL))
    expect(violations(code, FORBIDDEN_IN_FREE_CLAIM)).toEqual([])
    const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(m => m[1])
    expect(imports).toEqual(['jsr:@supabase/supabase-js@2.117.2', './handler.ts'])
    const env = [...code.matchAll(/Deno\.env\.get\(\s*'([^']+)'/g)].map(m => m[1])
    expect(env).toEqual(['SUPABASE_URL', 'SUPABASE_ANON_KEY'])
    expect((code.match(/\.auth\.getUser\(/g) ?? []).length).toBe(1)
  })
})

// ── The real entry point, against a local fake Supabase Auth ───────────────

/**
 * Serves `/auth/v1/user` on 127.0.0.1 like Supabase Auth and records every
 * request. Anything else (REST, RPC, storage) is recorded and answered 500.
 */
function fakeSupabase() {
  const seen: string[] = []
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, req => {
    const url = new URL(req.url)
    seen.push(`${req.method} ${url.pathname}`)
    if (url.pathname !== '/auth/v1/user') return new Response('unexpected', { status: 500 })
    if (req.headers.get('authorization') !== `Bearer ${VALID}`) {
      return Response.json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, { status: 401 })
    }
    return Response.json({ id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'a@example.test' })
  })
  return { url: `http://127.0.0.1:${server.addr.port}`, seen, close: () => server.shutdown() }
}

// A module runs once per process; later calls reuse what its first run registered.
let registered: ((req: Request) => Promise<Response>) | undefined

/** Imports the real index.ts with Deno.serve captured; each call sees `env` and records env reads. */
async function entryHandler(env: Record<string, string>) {
  if (!registered) {
    const savedServe = Deno.serve
    const handlers: Array<(req: Request) => Promise<Response>> = []
    // deno-lint-ignore no-explicit-any
    ;(Deno as any).serve = (h: (req: Request) => Promise<Response>) => { handlers.push(h); return { finished: Promise.resolve(), shutdown: async () => {} } }
    try {
      await import(INDEX_URL.href)
    } finally {
      // deno-lint-ignore no-explicit-any
      ;(Deno as any).serve = savedServe
    }
    if (handlers.length !== 1) throw new Error(`index.ts registered ${handlers.length} handlers`)
    registered = handlers[0]
  }
  const handler = registered
  const savedGet = Deno.env.get
  const envReads: string[] = []
  const call = async (req: Request) => {
    Deno.env.get = (name: string) => { envReads.push(name); return env[name] }
    try { return await handler(req) } finally { Deno.env.get = savedGet }
  }
  return { call, envReads }
}

describe('free-claim (retired): real index.ts', () => {
  it('free-claim entry: OPTIONS, no auth, invalid user, valid user; only the auth endpoint is ever called', async () => {
    const supa = fakeSupabase()
    try {
      const { call, envReads } = await entryHandler({ SUPABASE_URL: supa.url, SUPABASE_ANON_KEY: 'public-anon-key' })

      const pre = await call(request({ method: 'OPTIONS', auth: null }))
      expect(pre.status).toBe(200)
      await pre.text()
      const none = await call(request({ auth: null }))
      expect(none.status).toBe(401)
      await none.text()
      expect(supa.seen).toEqual([])

      const bad = await call(request({ auth: 'Bearer forged' }))
      expect(bad.status).toBe(401)
      expect(await bad.json()).toEqual({ error: 'No autorizado' })

      for (let i = 0; i < 3; i++) {
        const req = request()
        const ok = await call(req)
        expect(ok.status).toBe(410)
        expect(await ok.json()).toEqual({ code: FREE_CLAIM_RETIRED_CODE, error: FREE_CLAIM_RETIRED_MESSAGE, message: FREE_CLAIM_RETIRED_MESSAGE })
        expect(req.bodyUsed).toBe(false)
      }

      // One auth lookup per authenticated attempt, and nothing else: no REST, no RPC.
      expect(supa.seen).toEqual(Array(4).fill('GET /auth/v1/user'))
      expect([...new Set(envReads)].sort()).toEqual(['SUPABASE_ANON_KEY', 'SUPABASE_URL'])
    } finally {
      await supa.close()
    }
  })

  it('free-claim entry: auth unreachable fails closed with a generic 500', async () => {
    const { call } = await entryHandler({ SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'public-anon-key' })
    for (let i = 0; i < 2; i++) {
      const res = await call(request())
      // supabase-js reports an unreachable server as an error (→ 401) or throws (→ 500): either way, closed.
      expect(res.status === 401 || res.status === 500).toBe(true)
      expect(await res.text()).not.toMatch(/free_claim_retired|ECONNREFUSED|127\.0\.0\.1/)
    }
  })
})

// ── Mutations: the tests above must notice a regression ─────────────────────

describe('free-claim (retired): mutations', () => {
  it('free-claim: source rules catch service role, claim_slot, writes and body reads', async () => {
    const handler = await Deno.readTextFile(HANDLER_URL)
    const index = await Deno.readTextFile(INDEX_URL)
    const anchor = '  // `error` carries'
    const mutants: Array<[string, string, ReadonlyArray<RegExp>]> = [
      ['service role in index', index.replace("'SUPABASE_ANON_KEY'", "'SUPABASE_SERVICE_ROLE_KEY'"), FORBIDDEN_IN_FREE_CLAIM],
      ['claim_slot rpc in index', index.replace('return !error && !!user;', "await supabase.rpc('claim_slot', {});\n    return !error && !!user;"), FORBIDDEN_IN_FREE_CLAIM],
      ['daily reset in index', index.replace('return !error && !!user;', "await supabase.rpc('reset_daily_free_claim');\n    return !error && !!user;"), FORBIDDEN_IN_FREE_CLAIM],
      ['slots upsert in index', index.replace('return !error && !!user;', "await supabase.from('slots').upsert({ pokemon_id: 1 });\n    return !error && !!user;"), FORBIDDEN_IN_FREE_CLAIM],
      ['profile write in index', index.replace('return !error && !!user;', "await supabase.from('profiles').update({ free_claims_remaining: 0 });\n    return !error && !!user;"), FORBIDDEN_IN_FREE_CLAIM],
      ['body read in handler', handler.replace(anchor, `  await req.json()\n${anchor}`), [...FORBIDDEN_IN_FREE_CLAIM, ...FORBIDDEN_IN_HANDLER]],
      ['network in handler', handler.replace(anchor, `  await fetch('https://x/rest/v1/slots')\n${anchor}`), [...FORBIDDEN_IN_FREE_CLAIM, ...FORBIDDEN_IN_HANDLER]],
      ['secret in handler', handler.replace(anchor, `  Deno.env.get('X')\n${anchor}`), [...FORBIDDEN_IN_FREE_CLAIM, ...FORBIDDEN_IN_HANDLER]],
    ]
    for (const [label, mutant, rules] of mutants) {
      if (mutant === handler || mutant === index) throw new Error(`${label}: mutation anchor moved`)
      if (violations(stripComments(mutant), rules).length === 0) throw new Error(`${label}: not detected`)
    }
  })

  it('free-claim: the behavioral contract fails for a handler that succeeds, skips auth or reads the body', async () => {
    const original = await Deno.readTextFile(HANDLER_URL)
    const retired = 'return json({ code: FREE_CLAIM_RETIRED_CODE'
    const mutants: Array<[string, string]> = [
      ['answers 200 success', original.replace(/\}, 410\)/, '}, 200)')],
      ['grants a claim', original.replace(retired, "return json({ success: true, pokemon_id: 25 }, 200)\n  return json({ code: FREE_CLAIM_RETIRED_CODE")],
      ['skips auth', original.replace('if (!authenticated) return unauthorized()', '')],
      ['accepts a missing token', original.replace('if (!token) return unauthorized()', "if (!token) return json({ code: FREE_CLAIM_RETIRED_CODE }, 410)")],
      ['reads the body', original.replace(retired, `await req.text()\n  ${retired}`)],
      ['leaks the auth error', original.replace("json({ error: 'Error interno' }, 500)", "json({ error: String(err) }, 500)")],
      ['varies between calls', original.replace(retired, `if (Math.random() < 2) return json({ code: 'x' }, 410)\n  ${retired}`)],
      ['answers OPTIONS only when signed in', original.replace("if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })", '')],
    ]
    const dir = await Deno.makeTempDir({ prefix: 'free-claim-mutant-' })
    const consoleError = console.error
    console.error = () => {}
    try {
      for (const [i, [label, source]] of mutants.entries()) {
        if (source === original) throw new Error(`${label}: mutation anchor moved`)
        const file = `${dir}/handler_${i}.ts`
        await Deno.writeTextFile(file, source)
        const mod = await import(new URL(`file:///${file.replace(/\\/g, '/').replace(/^\/+/, '')}`).href)
        let failed = 0
        for (const [, check] of CONTRACT) {
          try { await check(mod.handleRetiredFreeClaim) } catch { failed++ }
        }
        if (failed === 0) throw new Error(`${label}: survived every contract check`)
      }
    } finally {
      console.error = consoleError
      await Deno.remove(dir, { recursive: true })
    }
  })
})
