// DGN-2: dungeon-start Edge Function (R15)
// Server gate for dungeon entry. Validates auth and deducts energy atomically
// via consume_dungeon_energy() SECURITY DEFINER RPC.
//
// Closes INV-DGN-5: energy deduction is now server-side and non-refundable.
// The client must call this before starting combat; a client that bypasses it
// cannot write slots.energy directly (no column grant for authenticated role).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const ERROR_MAP: Record<string, [string, number]> = {
  not_owner:          ['No sos el dueño de ese Pokémon',                   403],
  pokemon_locked:     ['Este Pokémon está en el mercado y no puede entrar al dungeon', 409],
  insufficient_energy:['Energía insuficiente para entrar al dungeon',      422],
};

interface StartBody {
  pokemon_id: number;
}

function isValidBody(b: unknown): b is StartBody {
  if (!b || typeof b !== 'object') return false;
  const { pokemon_id } = b as Record<string, unknown>;
  return Number.isInteger(pokemon_id) && (pokemon_id as number) > 0;
}

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Cuerpo inválido' }, { status: 400, headers: CORS });
    }
    if (!isValidBody(body)) {
      return Response.json(
        { error: 'Parámetros inválidos: pokemon_id requerido (entero > 0)' },
        { status: 400, headers: CORS },
      );
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data, error } = await userClient.rpc('consume_dungeon_energy', {
      p_pokemon_id: body.pokemon_id,
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
    console.error('dungeon-start error:', msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
