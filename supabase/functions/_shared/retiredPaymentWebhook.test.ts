// Run with: deno test --allow-read --allow-write --allow-env supabase/functions/_shared/
//
// Covers the four retired payment webhooks through their real index.ts:
// paypal-ipn, webhook-paypal, webhook-stripe, webhook-mercadopago.
import { handleRetiredPaymentWebhook, RETIRED_WEBHOOK_CORS_HEADERS } from './retiredPaymentWebhook.ts'
import {
  captureLogs,
  codeOf,
  describe,
  expect,
  FORBIDDEN_IN_ANY_RECEIVER,
  FORBIDDEN_IN_STUB,
  handlerOfEntry,
  importsOf,
  it,
  stripComments,
  violations,
  withTripwires,
} from './webhookTestKit.ts'

export const RETIRED_PAYMENT_WEBHOOKS = ['paypal-ipn', 'webhook-paypal', 'webhook-stripe', 'webhook-mercadopago'] as const

const SHARED = '../_shared/retiredPaymentWebhook.ts'

// What each provider actually sends, plus garbage. None of it may change the answer.
const BODIES: Array<{ label: string; body: BodyInit | null; headers?: Record<string, string> }> = [
  { label: 'empty', body: '' },
  { label: 'no body', body: null },
  {
    label: 'paypal ipn form',
    body: 'mc_gross=1.00&payment_status=Completed&custom=trainer_zeta&payer_email=payer%40example.com&txn_id=TXN123&receiver_email=shop%40example.com',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  },
  {
    label: 'paypal webhook event',
    body: JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1', amount: { value: '1.00' }, custom_id: 'user-1' } }),
    headers: { 'content-type': 'application/json', 'paypal-transmission-sig': 'sig', 'paypal-transmission-id': 'tid' },
  },
  {
    label: 'stripe event',
    body: JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: 'user-1', amount_total: 100 } } }),
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
  },
  {
    label: 'mercadopago notification',
    body: JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id: '123456' } }),
    headers: { 'content-type': 'application/json', 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req-1' },
  },
  { label: 'malformed json', body: '{"type": "payment", "data": ', headers: { 'content-type': 'application/json' } },
  { label: 'binary', body: new Uint8Array([0, 255, 1, 254, 128]) },
  { label: 'large', body: 'x'.repeat(1024 * 1024) },
]

const request = (slug: string, init: { method?: string; body?: BodyInit | null; headers?: Record<string, string> } = {}) => {
  const method = init.method ?? 'POST'
  return new Request(`https://x/functions/v1/${slug}?topic=payment&id=1`, {
    method,
    headers: init.headers ?? {},
    body: ['OPTIONS', 'GET', 'HEAD'].includes(method) ? undefined : init.body,
  })
}

function expectCors(res: Response) {
  for (const [name, value] of Object.entries(RETIRED_WEBHOOK_CORS_HEADERS)) expect(res.headers.get(name)).toBe(value)
}

async function fingerprint(res: Response) {
  return JSON.stringify({ status: res.status, body: await res.text(), headers: [...res.headers.entries()] })
}

for (const slug of RETIRED_PAYMENT_WEBHOOKS) {
  const indexUrl = new URL(`../${slug}/index.ts`, import.meta.url)

  describe(`${slug} (retired stub)`, () => {
    it(`${slug}: the entry point registers the shared stub and nothing else`, async () => {
      const { handler, serveCalls } = await handlerOfEntry(indexUrl)
      expect(serveCalls).toBe(1)
      expect(handler).toBe(handleRetiredPaymentWebhook)
    })

    it(`${slug}: answers the CORS preflight`, async () => {
      const { handler } = await handlerOfEntry(indexUrl)
      const res = await handler(request(slug, { method: 'OPTIONS' }))
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('ok')
      expectCors(res)
    })

    it(`${slug}: POST answers an empty 200 without JWT or signature`, async () => {
      const { handler } = await handlerOfEntry(indexUrl)
      const res = await handler(request(slug, { body: '{}' }))
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('')
      expectCors(res)
    })

    it(`${slug}: arbitrary bodies and methods get the same answer, and the body is never read`, async () => {
      const { handler } = await handlerOfEntry(indexUrl)
      const baseline = await fingerprint(await handler(request(slug, { body: '' })))
      for (const b of BODIES) {
        const req = request(slug, b)
        const got = await fingerprint(await handler(req))
        if (got !== baseline) throw new Error(`${b.label}: ${got} !== ${baseline}`)
        expect(req.bodyUsed).toBe(false)
      }
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        const req = request(slug, { method, body: 'x' })
        expect(await fingerprint(await handler(req))).toBe(baseline)
        expect(req.bodyUsed).toBe(false)
      }
    })

    it(`${slug}: no logs, network, env, files or RNG, even when replayed`, async () => {
      const { handler } = await handlerOfEntry(indexUrl)
      let logs: string[] = []
      const tripped = await withTripwires(async () => {
        logs = await captureLogs(async () => {
          for (let i = 0; i < 3; i++) for (const b of BODIES) await handler(request(slug, b))
        })
      })
      expect(tripped).toEqual([])
      expect(logs).toEqual([])
    })

    it(`${slug}: source has no admin import, secret, network, body read or database`, async () => {
      const index = await codeOf(indexUrl)
      expect(importsOf(index)).toEqual([SHARED])
      expect(violations(index, [...FORBIDDEN_IN_ANY_RECEIVER, ...FORBIDDEN_IN_STUB])).toEqual([])
    })
  })
}

describe('retiredPaymentWebhook (shared stub)', () => {
  it('has no imports and passes every stub rule', async () => {
    const code = await codeOf(new URL('./retiredPaymentWebhook.ts', import.meta.url))
    expect(importsOf(code)).toEqual([])
    expect(violations(code, [...FORBIDDEN_IN_ANY_RECEIVER, ...FORBIDDEN_IN_STUB])).toEqual([])
  })

  it('the stub rules catch a stub that parses the body, reads a secret or confirms a payment', async () => {
    const code = await Deno.readTextFile(new URL('./retiredPaymentWebhook.ts', import.meta.url))
    const mutants = [
      code.replace('return new Response(null', 'await req.json()\n  return new Response(null'),
      code.replace('return new Response(null', "Deno.env.get('STRIPE_WEBHOOK_SECRET')\n  return new Response(null"),
      code.replace('return new Response(null', "console.log(req.url)\n  return new Response(null"),
      code.replace('return new Response(null', "await fetch('https://api.mercadopago.com/v1/payments/1')\n  return new Response(null"),
      "import { createClient } from 'jsr:@supabase/supabase-js@2'\n" + code.replace('return new Response(null', "await createClient('u','k').rpc('confirm_payment')\n  return new Response(null"),
    ]
    for (const mutant of mutants) {
      if (mutant === code) throw new Error('mutation anchor moved')
      expect(violations(stripComments(mutant), [...FORBIDDEN_IN_ANY_RECEIVER, ...FORBIDDEN_IN_STUB]).length).toBeGreaterThan(0)
    }
  })

  it('every retired payment function directory is covered here', async () => {
    const dirs: string[] = []
    for await (const entry of Deno.readDir(new URL('../', import.meta.url))) {
      if (entry.isDirectory && /paypal|stripe|mercadopago/.test(entry.name)) dirs.push(entry.name)
    }
    expect(dirs.sort()).toEqual([...RETIRED_PAYMENT_WEBHOOKS].sort())
  })
})
