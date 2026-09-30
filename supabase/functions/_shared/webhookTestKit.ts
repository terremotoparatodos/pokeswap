// Test helpers for the payment webhook receivers (PAYMENTS RETIRE-2).
// Imported only by *.test.ts; no function's index.ts imports it, so it is never deployed.

export function expect(actual: unknown) {
  const show = (v: unknown) => JSON.stringify(v)
  return {
    toBe(expected: unknown) { if (actual !== expected) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    toEqual(expected: unknown) { if (show(actual) !== show(expected)) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    toBeGreaterThan(n: number) { if (!((actual as number) > n)) throw new Error(`expected > ${n}, got ${show(actual)}`) },
    not: { toMatch(pattern: RegExp) { if (pattern.test(String(actual))) throw new Error(`did not expect ${pattern} in ${show(actual)}`) } },
  }
}
export const it = (name: string, fn: () => Promise<void>) => Deno.test(name, fn)
export const describe = (_name: string, body: () => void) => body()

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const

/** Runs `fn` with every console method captured; returns one string per call. */
export async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = []
  const saved = CONSOLE_METHODS.map(m => [m, console[m]] as const)
  for (const m of CONSOLE_METHODS) {
    // deno-lint-ignore no-explicit-any
    (console as any)[m] = (...args: unknown[]) => {
      lines.push(args.map(a => (typeof a === 'string' ? a : safeJson(a))).join(' '))
    }
  }
  try { await fn() } finally {
    // deno-lint-ignore no-explicit-any
    for (const [m, f] of saved) (console as any)[m] = f
  }
  return lines
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

/** The received values that appear in any log line. Empty means no leak. */
export function leakedValues(logs: string[], received: string[]): string[] {
  const text = logs.join('\n')
  return received.filter(v => v.length > 0 && text.includes(v))
}

/**
 * Runs `fn` with network, env, RNG and file access replaced by tripwires.
 * `allowEnv` lists env names the code may read. Returns what was touched.
 */
export async function withTripwires(fn: () => Promise<void>, allowEnv: string[] = []): Promise<string[]> {
  const tripped: string[] = []
  const saved = {
    fetch: globalThis.fetch,
    random: Math.random,
    envGet: Deno.env.get,
    envToObject: Deno.env.toObject,
    connect: Deno.connect,
    readTextFile: Deno.readTextFile,
  }
  globalThis.fetch = ((input: unknown) => { tripped.push(`fetch ${String(input)}`); throw new Error('no network') }) as typeof fetch
  Math.random = () => { tripped.push('Math.random'); return 0 }
  const envGet = saved.envGet.bind(Deno.env)
  Deno.env.get = (name: string) => {
    if (!allowEnv.includes(name)) tripped.push(`env ${name}`)
    return envGet(name)
  }
  Deno.env.toObject = () => { tripped.push('env *'); return {} }
  Deno.connect = (() => { tripped.push('Deno.connect'); throw new Error('no network') }) as typeof Deno.connect
  Deno.readTextFile = ((p: string | URL) => { tripped.push(`read ${String(p)}`); throw new Error('no files') }) as typeof Deno.readTextFile
  try { await fn() } finally {
    globalThis.fetch = saved.fetch
    Math.random = saved.random
    Deno.env.get = saved.envGet
    Deno.env.toObject = saved.envToObject
    Deno.connect = saved.connect
    Deno.readTextFile = saved.readTextFile
  }
  return tripped
}

/** Source without comments: comments may describe the old flow, the code may not contain it. */
export async function codeOf(url: URL): Promise<string> {
  return stripComments(await Deno.readTextFile(url))
}
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
}

export function importsOf(code: string): string[] {
  return [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), ...code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)].map(m => m[1])
}

/** Code no payment receiver may contain: database, privileged access, network, old effects. */
export const FORBIDDEN_IN_ANY_RECEIVER: ReadonlyArray<RegExp> = [
  /@supabase|supabase-js|createClient/,
  /SERVICE_ROLE|service_role/i,
  /SUPABASE_(URL|ANON_KEY|DB_URL)/,
  /\.from\(|\.rpc\(|\.(insert|update|upsert|delete|select)\(/,
  /auth\.admin|listUsers/,
  /\bfetch\(|Deno\.connect|WebSocket|XMLHttpRequest/,
  /\bimport\(/,
  /Deno\.(readFile|readTextFile|writeFile|writeTextFile|open|Command|run)\b/,
  /\bprofiles\b|swap_cooldown|kofi_payments|token_ledger|\btransactions\b|confirm_payment|claim_slot/,
  /\btokens\b|balance|owner_id|\bslots\b/,
]

/** Extra rules for the four retired stubs: no secret, no body, no logs. */
export const FORBIDDEN_IN_STUB: ReadonlyArray<RegExp> = [
  /Deno\.env/,
  /\.(json|text|formData|arrayBuffer|blob|bytes)\(\)|\.body\b|getReader/,
  /console\./,
]

export function violations(code: string, rules: ReadonlyArray<RegExp>): string[] {
  return rules.filter(r => r.test(code)).map(r => String(r))
}

export type ServeHandler = (req: Request) => Response | Promise<Response>

/**
 * Imports a function's real index.ts with Deno.serve captured, and returns the
 * handler it registered. Proves the deployed entry point wires what the tests test.
 */
const entries = new Map<string, { handler: ServeHandler; serveCalls: number }>()

export async function handlerOfEntry(indexUrl: URL): Promise<{ handler: ServeHandler; serveCalls: number }> {
  // A module runs once per process; later calls get what its first run registered.
  const known = entries.get(indexUrl.href)
  if (known) return known
  const saved = Deno.serve
  const handlers: ServeHandler[] = []
  // deno-lint-ignore no-explicit-any
  ;(Deno as any).serve = (handler: ServeHandler) => { handlers.push(handler); return { finished: Promise.resolve(), shutdown: async () => {} } }
  try {
    await import(indexUrl.href)
  } finally {
    // deno-lint-ignore no-explicit-any
    ;(Deno as any).serve = saved
  }
  if (handlers.length !== 1 || typeof handlers[0] !== 'function') throw new Error(`${indexUrl.pathname} registered ${handlers.length} handlers`)
  const entry = { handler: handlers[0], serveCalls: handlers.length }
  entries.set(indexUrl.href, entry)
  return entry
}
