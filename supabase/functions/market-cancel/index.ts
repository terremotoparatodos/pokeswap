// MKT-5: market-cancel Edge Function
// Thin wrapper around the cancel_market_listing SECURITY DEFINER RPC.
// The RPC is called with the user's JWT so auth.uid() resolves correctly.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const ERROR_MAP: Record<string, [string, number]> = {
  listing_not_found:  ['Publicación no encontrada',                      404],
  not_seller:         ['No sos el vendedor de esa publicación',          403],
  already_purchased:  ['Esa publicación ya fue comprada',                409],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    // Use the user's JWT so auth.uid() resolves in the RPC
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    const body = await req.json().catch(() => null);
    const { listing_id } = body ?? {};

    if (!listing_id || typeof listing_id !== 'string') {
      return Response.json({ error: 'listing_id requerido' }, { status: 400, headers: CORS });
    }

    const { data, error } = await userClient.rpc('cancel_market_listing', {
      p_listing_id: listing_id,
    });

    if (error) {
      const match = Object.entries(ERROR_MAP).find(([k]) => error.message?.includes(k));
      if (match) {
        return Response.json({ error: match[1][0] }, { status: match[1][1], headers: CORS });
      }
      throw error;
    }

    return Response.json({ success: true, pokemon_id: (data as any).pokemon_id }, { headers: CORS });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('market-cancel error:', msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
