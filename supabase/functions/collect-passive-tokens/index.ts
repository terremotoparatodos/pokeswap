// TKN-3: collect-passive-tokens Edge Function (R10)
// Delegates to the collect_passive_tokens() RPC which owns the token math.
// Rate limiting here is belt-and-suspenders; the RPC enforces the 3-min gap too.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const ERROR_MAP: Record<string, [string, number]> = {
  profile_not_found:  ['Perfil no encontrado',                        404],
  too_soon:           ['Esperá unos minutos para cobrar de nuevo',    429],
  no_pokemon_owned:   ['No tenés Pokémon que generen tokens',         422],
  no_tokens_earned:   ['No hay tokens acumulados aún',                422],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    // Rate limit: max 20 collection calls per hour
    const { data: allowed } = await serviceClient.rpc('check_rate_limit', {
      p_user_id: user.id,
      p_action: 'collect_passive_tokens',
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (!allowed) {
      return Response.json(
        { error: 'Demasiadas solicitudes. Intentá en unos minutos.' },
        { status: 429, headers: CORS },
      );
    }

    // User-JWT client so auth.uid() resolves correctly inside the RPC
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data, error } = await userClient.rpc('collect_passive_tokens');

    if (error) {
      const match = Object.entries(ERROR_MAP).find(([k]) => error.message?.includes(k));
      if (match) {
        return Response.json({ error: match[1][0] }, { status: match[1][1], headers: CORS });
      }
      throw error;
    }

    const result = data as { delta: number; new_balance: number };
    return Response.json({ success: true, ...result }, { headers: CORS });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('collect-passive-tokens error:', msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
