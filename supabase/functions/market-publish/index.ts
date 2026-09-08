// MKT-4: market-publish Edge Function
// Thin wrapper around the publish_market_listing SECURITY DEFINER RPC.
// The RPC is called with the user's JWT so auth.uid() resolves correctly.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const ERROR_MAP: Record<string, [string, number]> = {
  not_owner:             ['No sos el dueño de ese Pokémon',               403],
  already_locked:        ['Ese Pokémon ya está publicado en el mercado',  409],
  pokemon_admin_locked:  ['Ese Pokémon no puede ser publicado',           403],
  active_listing_exists: ['Ya existe una publicación activa para ese Pokémon', 409],
  invalid_price:         ['El precio debe ser mayor a 0',                 400],
  slot_not_found:        ['Pokémon no encontrado',                        404],
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
    const { pokemon_id, price_tokens } = body ?? {};

    if (!Number.isInteger(pokemon_id) || pokemon_id <= 0) {
      return Response.json({ error: 'pokemon_id inválido' }, { status: 400, headers: CORS });
    }
    if (!Number.isInteger(price_tokens) || price_tokens <= 0) {
      return Response.json({ error: 'price_tokens debe ser un entero positivo' }, { status: 400, headers: CORS });
    }

    const { data, error } = await userClient.rpc('publish_market_listing', {
      p_pokemon_id: pokemon_id,
      p_price_tokens: price_tokens,
    });

    if (error) {
      const match = Object.entries(ERROR_MAP).find(([k]) => error.message?.includes(k));
      if (match) {
        return Response.json({ error: match[1][0] }, { status: match[1][1], headers: CORS });
      }
      throw error;
    }

    return Response.json({ success: true, listing_id: (data as any).listing_id }, { headers: CORS });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('market-publish error:', msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
