import { createClient } from 'jsr:@supabase/supabase-js@2';

const COOLDOWN_HOURS = 8;
const SHINY_CHANCE = 1 / 128;
const AURA_TRANSFER_PCT = 0.2;
const SKIP_COST = 1000;

const RARITY_TABLE = [
  { tier: 'comun',      weight: 60 },
  { tier: 'poco_comun', weight: 25 },
  { tier: 'raro',       weight: 10 },
  { tier: 'epico',      weight: 4  },
  { tier: 'legendario', weight: 1  },
];

function rollRarity(): string {
  const total = RARITY_TABLE.reduce((a, r) => a + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of RARITY_TABLE) { roll -= r.weight; if (roll <= 0) return r.tier; }
  return 'comun';
}

function rollShiny(): boolean { return Math.random() < SHINY_CHANCE; }

Deno.serve(async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    // supabase-js adds these to browser invocations; allow the full preflight.
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return Response.json({ error: 'No autorizado' }, { status: 401, headers: cors });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return Response.json({ error: 'No autorizado' }, { status: 401, headers: cors });

    const body = await req.json().catch(() => ({}));
    const pokemonGivenId: number | null = body.pokemon_given_id ?? null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('tokens, swap_cooldown_until, username')
      .eq('id', user.id)
      .single();

    if (!profile) return Response.json({ error: 'Perfil no encontrado' }, { status: 404, headers: cors });

    const now = new Date();
    const cooldownUntil = profile.swap_cooldown_until ? new Date(profile.swap_cooldown_until) : null;
    const inCooldown = cooldownUntil && cooldownUntil > now;

    if (inCooldown) {
      const minutesLeft = Math.ceil((cooldownUntil!.getTime() - now.getTime()) / 60000);
      return Response.json({ error: `Cooldown activo. Faltan ${minutesLeft} minutos.`, cooldown_until: profile.swap_cooldown_until }, { headers: cors });
    }

    // Obtener slots disponibles (no bloqueados)
    const { data: mySlots } = await supabase
      .from('slots')
      .select('pokemon_id, aura, is_locked')
      .eq('owner_id', user.id)
      .eq('is_locked', false);

    if (!mySlots || mySlots.length === 0)
      return Response.json({ error: 'No tenés Pokémon disponibles. (Los que están en el Mercado no se pueden swapear.)' }, { headers: cors });

    // Usar el pokemon elegido por el usuario, validar que sea suyo
    let mySlot = mySlots[Math.floor(Math.random() * mySlots.length)];
    if (pokemonGivenId) {
      const chosen = mySlots.find((s: any) => s.pokemon_id === pokemonGivenId);
      if (chosen) mySlot = chosen;
      // Si no se encuentra (no es suyo o está bloqueado) usamos random como fallback seguro
    }

    const rarity = rollRarity();
    const isShiny = rollShiny();
    const myIds = mySlots.map((s: any) => s.pokemon_id);

    const rarityPriceMap: Record<string, { min: number; max: number }> = {
      comun:      { min: 1, max: 2 },
      poco_comun: { min: 2, max: 3 },
      raro:       { min: 3, max: 5 },
      epico:      { min: 5, max: 8 },
      legendario: { min: 8, max: 99 },
    };
    const priceRange = rarityPriceMap[rarity];

    let { data: candidates } = await supabase.from('pokemon').select('id, name_es, base_price')
      .eq('locked', false).gte('base_price', priceRange.min).lte('base_price', priceRange.max)
      .not('id', 'in', `(${myIds.join(',')})`).order('id');

    if (!candidates || candidates.length === 0) {
      const { data: fallback } = await supabase.from('pokemon').select('id, name_es, base_price')
        .eq('locked', false).not('id', 'in', `(${myIds.join(',')})`).order('id');
      candidates = fallback || [];
    }

    if (!candidates || candidates.length === 0)
      return Response.json({ error: 'No hay Pokémon disponibles.' }, { headers: cors });

    const received = candidates[Math.floor(Math.random() * candidates.length)];
    const newCooldown = new Date(now.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const auraTransferred = Math.floor((mySlot.aura || 0) * AURA_TRANSFER_PCT);

    // Liberar el slot dado
    await supabase.from('slots').update({
      owner_id: null, owner_username: null, aura: 0,
      aura_updated_at: now.toISOString(), owned_since: null,
      is_locked: false, updated_at: now.toISOString()
    }).eq('pokemon_id', mySlot.pokemon_id).eq('owner_id', user.id);

    // Asignar el slot recibido
    await supabase.from('slots').upsert({
      pokemon_id: received.id, owner_id: user.id, owner_username: profile.username,
      aura: auraTransferred, aura_updated_at: now.toISOString(), owned_since: now.toISOString(),
      is_locked: false, updated_at: now.toISOString(), last_claimed_at: now.toISOString(),
    }, { onConflict: 'pokemon_id' });

    await supabase.from('profiles').update({
      swap_cooldown_until: newCooldown,
      updated_at: now.toISOString(),
    }).eq('id', user.id);

    await supabase.from('swap_history').insert({
      user_id: user.id, pokemon_given_id: mySlot.pokemon_id,
      pokemon_received_id: received.id, was_shiny: isShiny, rarity,
    }).maybeSingle();

    return Response.json({
      success: true,
      given: { pokemon_id: mySlot.pokemon_id },
      received: { pokemon_id: received.id, name: received.name_es, rarity, is_shiny: isShiny },
      cooldown_until: newCooldown,
    }, { headers: cors });

  } catch (err: any) {
    console.error('pokeswap-swap error:', err);
    return Response.json({ error: err.message || 'Error interno' }, { status: 500, headers: cors });
  }
});
