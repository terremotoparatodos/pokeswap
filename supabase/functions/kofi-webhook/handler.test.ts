// Run with: deno test --allow-read --allow-write --allow-env supabase/functions/kofi-webhook/
import {
  handleKofiWebhook,
  KOFI_CORS_HEADERS,
  KOFI_LOG,
  KOFI_MAX_BODY_BYTES,
  type KofiWebhookDeps,
} from './handler.ts'
import {
  captureLogs,
  codeOf,
  describe,
  expect,
  FORBIDDEN_IN_ANY_RECEIVER,
  handlerOfEntry,
  importsOf,
  it,
  leakedValues,
  stripComments,
  violations,
  withTripwires,
} from '../_shared/webhookTestKit.ts'

const SECRET = 'kofi-verification-7f3a9c1e'

// A realistic Ko-fi donation. Every personal field is distinctive so a leak is findable.
const DONATION = {
  verification_token: SECRET,
  message_id: 'msg-3a1c7e2b-leakcheck',
  timestamp: '2026-09-30T12:00:00Z',
  type: 'Donation',
  is_public: true,
  from_name: 'Donor Fullname Zeta',
  message: 'please reset cooldown for trainer_zeta',
  amount: '5.00',
  url: 'https://ko-fi.com/Home/CoffeeShop?txid=leakcheck',
  email: 'donor.private.zeta@example.com',
  currency: 'USD',
  is_subscription_payment: false,
  is_first_subscription_payment: false,
  kofi_transaction_id: 'kofi-txn-9c2e44-leakcheck',
  shop_items: null,
  tier_name: null,
  shipping: null,
}
const RECEIVED_VALUES = [
  SECRET, DONATION.message_id, DONATION.from_name, DONATION.message, DONATION.email,
  DONATION.kofi_transaction_id, DONATION.url, 'trainer_zeta', 'donor.private',
]

const form = (fields: Record<string, unknown>) => new URLSearchParams({ data: JSON.stringify(fields) }).toString()

const request = (init: { method?: string; body?: BodyInit | null; contentType?: string; headers?: Record<string, string> } = {}) => {
  const method = init.method ?? 'POST'
  return new Request('https://x/functions/v1/kofi-webhook', {
    method,
    headers: { 'content-type': init.contentType ?? 'application/x-www-form-urlencoded', ...init.headers },
    body: ['OPTIONS', 'GET', 'HEAD'].includes(method) ? undefined : (init.body === undefined ? form(DONATION) : init.body),
  })
}

/** `deps()` has the right secret; `deps(undefined)` models an unset one. */
function deps(...args: [secret?: string | undefined, reads?: string[]]): KofiWebhookDeps {
  const secret = args.length === 0 ? SECRET : args[0]
  const reads = args[1] ?? []
  return { verificationToken: () => { reads.push('token'); return secret } }
}

function expectCors(res: Response) {
  for (const [name, value] of Object.entries(KOFI_CORS_HEADERS)) expect(res.headers.get(name)).toBe(value)
}

async function expectReply(res: Response, status: number, body: string) {
  expect(res.status).toBe(status)
  expect(await res.text()).toBe(body)
  expectCors(res)
}

const ALLOWED_LOGS: string[] = Object.values(KOFI_LOG)

/** Every log line is one of the fixed strings and quotes nothing that was received. */
function expectCleanLogs(logs: string[], received: string[] = RECEIVED_VALUES) {
  expect(leakedValues(logs, received)).toEqual([])
  for (const line of logs) if (!ALLOWED_LOGS.includes(line)) throw new Error(`unexpected log line: ${line}`)
}

describe('kofi-webhook (donation receiver, no effects)', () => {
  it('answers the CORS preflight without reading the secret or the body', async () => {
    const reads: string[] = []
    const req = request({ method: 'OPTIONS' })
    const logs = await captureLogs(async () => {
      const res = await handleKofiWebhook(req, deps(SECRET, reads))
      await expectReply(res, 200, 'ok')
    })
    expect(reads).toEqual([])
    expect(logs).toEqual([])
  })

  it('fails closed with a generic 503 when the secret is missing or empty, before reading the body', async () => {
    for (const secret of [undefined, '']) {
      const req = request()
      const logs = await captureLogs(async () => {
        await expectReply(await handleKofiWebhook(req, deps(secret)), 503, 'unavailable')
      })
      expect(req.bodyUsed).toBe(false)
      expect(logs).toEqual([KOFI_LOG.notConfigured])
    }
  })

  it('rejects a wrong, missing or mistyped token with a generic 401 and logs nothing received', async () => {
    const bad: Array<Record<string, unknown>> = [
      { ...DONATION, verification_token: 'kofi-verification-7f3a9c1f' },
      { ...DONATION, verification_token: SECRET.slice(0, -1) },
      { ...DONATION, verification_token: SECRET + 'x' },
      { ...DONATION, verification_token: SECRET.toUpperCase() },
      { ...DONATION, verification_token: '' },
      { ...DONATION, verification_token: 12345 },
      { ...DONATION, verification_token: [SECRET] },
      { ...DONATION, verification_token: null },
      (({ verification_token: _, ...rest }) => rest)(DONATION),
    ]
    for (const fields of bad) {
      const logs = await captureLogs(async () => {
        await expectReply(await handleKofiWebhook(request({ body: form(fields) }), deps()), 401, 'unauthorized')
      })
      expect(logs).toEqual([KOFI_LOG.rejected])
      expectCleanLogs(logs)
    }
  })

  it('acknowledges a valid donation with a generic 200', async () => {
    const reads: string[] = []
    const logs = await captureLogs(async () => {
      await expectReply(await handleKofiWebhook(request(), deps(SECRET, reads)), 200, 'ok')
    })
    expect(reads).toEqual(['token'])
    expect(logs).toEqual([KOFI_LOG.acknowledged])
    expectCleanLogs(logs)
  })

  it('also accepts Ko-fi sending the form as multipart', async () => {
    const body = new FormData()
    body.set('data', JSON.stringify(DONATION))
    const req = new Request('https://x/functions/v1/kofi-webhook', { method: 'POST', body })
    await expectReply(await handleKofiWebhook(req, deps()), 200, 'ok')
  })

  it('answers ignored events exactly like a donation: 200, nothing else', async () => {
    const events: Array<Record<string, unknown>> = [
      { ...DONATION, is_public: false },
      { ...DONATION, type: 'Subscription', is_subscription_payment: true, tier_name: 'Gold' },
      { ...DONATION, type: 'Shop Order', shop_items: [{ direct_link_code: 'abc', variation_name: 'x', quantity: 1 }] },
      { ...DONATION, type: 'Commission' },
      { ...DONATION, amount: '0.01' },
      { ...DONATION, amount: '1000000' },
      { verification_token: SECRET },
    ]
    for (const fields of events) {
      const logs = await captureLogs(async () => {
        await expectReply(await handleKofiWebhook(request({ body: form(fields) }), deps()), 200, 'ok')
      })
      expectCleanLogs(logs)
    }
  })

  it('answers a duplicate delivery 200 every time, with nothing to dedupe', async () => {
    const tripped = await withTripwires(async () => {
      for (let i = 0; i < 5; i++) await expectReply(await handleKofiWebhook(request(), deps()), 200, 'ok')
    })
    expect(tripped).toEqual([])
  })

  it('rejects a malformed body with a generic 401 and no parse error in the logs', async () => {
    const bodies: Array<{ body: BodyInit | null; contentType?: string; method?: string }> = [
      { body: '' },
      { body: 'not a form at all {"verification_token":"' + SECRET + '"}' },
      { body: 'data=' },
      { body: 'data=%7Bnot-json' },
      { body: new URLSearchParams({ data: JSON.stringify([SECRET]) }).toString() },
      { body: new URLSearchParams({ data: JSON.stringify(SECRET) }).toString() },
      { body: new URLSearchParams({ data: 'null' }).toString() },
      { body: new URLSearchParams({ other: JSON.stringify(DONATION) }).toString() },
      { body: JSON.stringify(DONATION), contentType: 'application/json' },
      { body: form(DONATION), contentType: 'text/plain' },
      { body: new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x3d]) },
      { body: null, method: 'GET' },
      { body: null, method: 'PUT' },
    ]
    for (const b of bodies) {
      const logs = await captureLogs(async () => {
        await expectReply(await handleKofiWebhook(request(b), deps()), 401, 'unauthorized')
      })
      expect(logs).toEqual([KOFI_LOG.rejected])
      expectCleanLogs(logs)
    }
  })

  it('rejects an oversized body without buffering it, whether or not it declares its length', async () => {
    const padded = form({ ...DONATION, message: 'x'.repeat(KOFI_MAX_BODY_BYTES) })
    await expectReply(await handleKofiWebhook(request({ body: padded }), deps()), 401, 'unauthorized')
    await expectReply(
      await handleKofiWebhook(request({ body: form(DONATION), headers: { 'content-length': String(KOFI_MAX_BODY_BYTES + 1) } }), deps()),
      401, 'unauthorized',
    )
    // 1 MiB streamed with no declared length: the handler must stop pulling at the cap.
    let pulled = 0
    const streamed = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === 256) return controller.close()
        pulled++
        controller.enqueue(new Uint8Array(4096).fill(0x61))
      },
    })
    await expectReply(await handleKofiWebhook(request({ body: streamed }), deps()), 401, 'unauthorized')
    expect(pulled <= Math.ceil(KOFI_MAX_BODY_BYTES / 4096) + 2).toBe(true)
  })

  it('never prints anything it received, on any path', async () => {
    const raw = form(DONATION)
    const logs = await captureLogs(async () => {
      await handleKofiWebhook(request(), deps())
      await handleKofiWebhook(request({ body: form({ ...DONATION, verification_token: 'wrong' }) }), deps())
      await handleKofiWebhook(request(), deps(undefined))
      await handleKofiWebhook(request({ body: 'data=%7Bbroken ' + DONATION.email }), deps())
    })
    expect(leakedValues(logs, [...RECEIVED_VALUES, raw, 'wrong'])).toEqual([])
    expectCleanLogs(logs)
  })

  it('touches no network, file, RNG or env beyond the injected secret', async () => {
    const tripped = await withTripwires(async () => {
      for (const body of [form(DONATION), form({ ...DONATION, verification_token: 'no' }), 'garbage']) {
        await handleKofiWebhook(request({ body }), deps())
      }
    })
    expect(tripped).toEqual([])
  })

  it('the deployed entry point reads only KOFI_VERIFICATION_TOKEN and wires this handler', async () => {
    const { handler } = await handlerOfEntry(new URL('./index.ts', import.meta.url))
    const saved = Deno.env.get('KOFI_VERIFICATION_TOKEN')
    try {
      Deno.env.delete('KOFI_VERIFICATION_TOKEN')
      const unset = await withTripwires(async () => {
        await expectReply(await handler(request()), 503, 'unavailable')
      }, ['KOFI_VERIFICATION_TOKEN'])
      expect(unset).toEqual([])

      Deno.env.set('KOFI_VERIFICATION_TOKEN', SECRET)
      const tripped = await withTripwires(async () => {
        await expectReply(await handler(request({ method: 'OPTIONS' })), 200, 'ok')
        await expectReply(await handler(request()), 200, 'ok')
        await expectReply(await handler(request({ body: form({ ...DONATION, verification_token: 'x' }) })), 401, 'unauthorized')
      }, ['KOFI_VERIFICATION_TOKEN'])
      expect(tripped).toEqual([])
    } finally {
      if (saved === undefined) Deno.env.delete('KOFI_VERIFICATION_TOKEN')
      else Deno.env.set('KOFI_VERIFICATION_TOKEN', saved)
    }
  })

  it('has no Supabase import, service role or database operation', async () => {
    const handler = await codeOf(new URL('./handler.ts', import.meta.url))
    const index = await codeOf(new URL('./index.ts', import.meta.url))
    expect(violations(handler, FORBIDDEN_IN_ANY_RECEIVER)).toEqual([])
    expect(violations(index, FORBIDDEN_IN_ANY_RECEIVER)).toEqual([])
    expect(importsOf(handler)).toEqual([])
    expect(importsOf(index)).toEqual(['./handler.ts'])
    // The secret reaches the handler only through its deps.
    expect(handler).not.toMatch(/Deno\.env/)
    expect([...index.matchAll(/Deno\.env\.(\w+)\(([^)]*)\)/g)].map(m => `${m[1]}(${m[2]})`)).toEqual([
      "get('KOFI_VERIFICATION_TOKEN')",
    ])
  })
})

// Mutation checks: the guards above must catch the two regressions that matter.
describe('kofi-webhook guards catch regressions', () => {
  const HOOK = 'export async function handleKofiWebhook(req: Request, deps: KofiWebhookDeps): Promise<Response> {'

  async function mutant(inject: string): Promise<{ source: string; handle: typeof handleKofiWebhook }> {
    const original = await Deno.readTextFile(new URL('./handler.ts', import.meta.url))
    if (!original.includes(HOOK)) throw new Error('mutation anchor moved; update HOOK')
    const source = original.replace(HOOK, `${HOOK}\n${inject}\n`)
    const file = await Deno.makeTempFile({ suffix: '.ts' })
    try {
      await Deno.writeTextFile(file, source)
      const mod = await import(new URL(`file:///${file.replace(/\\/g, '/').replace(/^\/+/, '')}`).href)
      return { source, handle: mod.handleKofiWebhook }
    } finally {
      await Deno.remove(file)
    }
  }

  it('a handler that logs the payload fails the log checks', async () => {
    const { handle } = await mutant(`  if (req.method === 'POST') console.log('Ko-fi webhook:', await req.clone().text())`)
    const logs = await captureLogs(async () => {
      const res = await handle(request(), deps())
      expect(res.status).toBe(200)
    })
    expect(leakedValues(logs, RECEIVED_VALUES).length).toBeGreaterThan(0)
    let caught = false
    try { expectCleanLogs(logs) } catch { caught = true }
    expect(caught).toBe(true)
  })

  it('a handler that writes the swap cooldown fails the source and network checks', async () => {
    const write = [
      `  try {`,
      `    await fetch('https://project.supabase.co/rest/v1/profiles?id=eq.x', {`,
      `      method: 'PATCH', body: JSON.stringify({ swap_cooldown_until: new Date().toISOString() }),`,
      `    })`,
      `  } catch { /* the tripwire refuses the network */ }`,
    ].join('\n')
    const { source, handle } = await mutant(write)
    expect(violations(stripComments(source), FORBIDDEN_IN_ANY_RECEIVER).length).toBeGreaterThan(0)
    const tripped = await withTripwires(async () => { await handle(request(), deps()) })
    expect(tripped.some(t => t.startsWith('fetch https://project.supabase.co'))).toBe(true)

    const client = `import { createClient } from 'jsr:@supabase/supabase-js@2'\n`
    const viaClient = client + source.replace(HOOK, `${HOOK}\n  await createClient('u', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!).from('profiles').update({ swap_cooldown_until: null })\n`)
    const found = violations(stripComments(viaClient), FORBIDDEN_IN_ANY_RECEIVER)
    for (const rule of ['createClient', 'SERVICE_ROLE', '\\.from', 'swap_cooldown']) {
      if (!found.some(f => f.includes(rule))) throw new Error(`rule for ${rule} did not fire: ${found.join(', ')}`)
    }
  })
})
