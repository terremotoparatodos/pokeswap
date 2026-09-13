// DGN-1: dungeon-reward Edge Function (R14)
// Validates a completed dungeon session and applies XP + token rewards
// via the award_dungeon_reward() SECURITY DEFINER RPC.
//
// Closes V-02 (dungeon tokens) and V-03 (XP) — dungeon results are now
// applied server-side with the daily token cap enforced in the RPC.
// Dungeon combat itself remains client-side (INV-DGN-1).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const ERROR_MAP: Record<string, [string, number]> = {
  not_owner:        ['No sos el dueño de ese Pokémon', 403],
  profile_not_found:['Perfil no encontrado',           404],
  invalid_xp_amount:['Cantidad de XP inválida',        422],
};

interface RewardBody {
  pokemon_id:    number;
  xp_earned:     number;
  tokens_earned: number;
}

function isValidRewardBody(b: unknown): b is RewardBody {
  if (!b || typeof b !== 'object') return false;
  const { pokemon_id, xp_earned, tokens_earned } = b as Record<string, unknown>;
  return (
    Number.isInteger(pokemon_id)    && (pokemon_id as number) > 0 &&
    Number.isInteger(xp_earned)     && (xp_earned as number) >= 0 &&
    Number.isInteger(tokens_earned) && (tokens_earned as number) >= 0
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    // Verify the JWT using the service-role client
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS });
    }

    // Parse and validate body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Cuerpo inválido' }, { status: 400, headers: CORS });
    }
    if (!isValidRewardBody(body)) {
      return Response.json(
        { error: 'Parámetros inválidos: pokemon_id, xp_earned y tokens_earned son requeridos (enteros ≥ 0)' },
        { status: 400, headers: CORS },
      );
    }

    // Call the RPC with the user JWT so auth.uid() resolves to the caller
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data, error } = await userClient.rpc('award_dungeon_reward', {
      p_pokemon_id:    body.pokemon_id,
      p_xp_amount:     body.xp_earned,
      p_tokens_amount: body.tokens_earned,
    });

    if (error) {
      const match = Object.entries(ERROR_MAP).find(([k]) => error.message?.includes(k));
      if (match) {
        return Response.json({ error: match[1][0] }, { status: match[1][1], headers: CORS });
      }
      throw error;
    }

    return Response.json({ success: true, ...data }, { headers: CORS });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('dungeon-reward error:', msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
