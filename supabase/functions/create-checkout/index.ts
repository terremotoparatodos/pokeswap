// create-checkout — DISABLED.
//
// PokeSwap does not take web payments for now (product decision, 2026-09-24).
// This used to start MercadoPago and PayPal checkouts and a tokens claim; it
// now answers every request with an explicit 503 and contacts no provider,
// reads no secret and writes nothing.
//
// The name stays deployed so a legacy client gets a clear error instead of a
// 404. A future payment system should be designed fresh (server-verified
// payment, idempotent webhooks — AGENTS.md §12), not restored from history.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  return Response.json(
    { error: 'payments_disabled', message: 'Los pagos no están disponibles por el momento.' },
    { status: 503, headers: cors },
  );
});
