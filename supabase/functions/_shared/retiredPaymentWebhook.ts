// Retired payment webhooks (PAYMENTS RETIRE-2): paypal-ipn, webhook-paypal,
// webhook-stripe and webhook-mercadopago.
//
// PayPal, Stripe and MercadoPago are disabled. The hosted versions validated,
// captured or confirmed payments and wrote cooldowns and payment rows with the
// service role. These stubs replace them so that each provider gets a plain
// 200 and stops retrying a retired endpoint.
//
// A stub never reads the body, reads no secret, calls no provider, creates no
// Supabase client and writes nothing. It logs nothing either: there is nothing
// to say about a request it does not look at. The providers keep their own
// records of every notification.

export const RETIRED_WEBHOOK_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

export function handleRetiredPaymentWebhook(req: Request): Response {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: RETIRED_WEBHOOK_CORS_HEADERS })
  // Empty 200: what PayPal IPN asks for, and enough for Stripe and MercadoPago.
  return new Response(null, { status: 200, headers: RETIRED_WEBHOOK_CORS_HEADERS })
}
