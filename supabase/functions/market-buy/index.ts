// MKT-6: market-buy Edge Function (updated for R09)
// The full purchase sequence is now handled atomically by buy_market_listing RPC.
// Rate limiting remains here (network-boundary concern, not transactional).
// The RPC is called with the user's JWT so auth.uid() resolves correctly.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const ERROR_MAP: Record<string, [string, number]> = {
  listing_not_found:        ['Publicación no encontrada o expirada',       404],
  already_purchased:        ['Ese Pokémon ya fue comprado',                409],
  listing_expired:          ['Esa publicación expiró',                     410],
  cannot_buy_own_listing:   ['No podés comprarte tu propio Pokémon',       403],
  insufficient_tokens:      ['Tokens insuficientes',                       402],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    // Service role client — used only for the rate limit check
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    // Rate limit: max 20 purchases per hour
    const { data: allowed } = await serviceClient.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_action: 'market_buy',
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (!allowed) {
      return Response.json(
        { error: 'Demasiadas compras. Intentá en unos minutos.' },
        { status: 429, headers: CORS },
      );
    }

    const body = await req.json().catch(() => null);
    const { listing_id } = body ?? {};
    if (!listing_id || typeof listing_id !== 'string') {
      return Response.json({ error: 'listing_id requerido' }, { status: 400, headers: CORS });
    }

    // User-JWT client — buy_market_listing uses auth.uid() to identify the buyer
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data, error } = await userClient.rpc('buy_market_listing', {
      p_listing_id: listing_id,
    });

    if (error) {
      const match = Object.entries(ERROR_MAP).find(([k]) => error.message?.includes(k));
      if (match) {
        return Response.json({ error: match[1][0] }, { status: match[1][1], headers: CORS });
      }
      throw error;
    }

    const result = data as { pokemon_id: number; price_paid: number; fee: number; seller_received: number };
    return Response.json({ success: true, ...result }, { headers: CORS });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('market-buy error:', msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
