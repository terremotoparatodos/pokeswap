// pokeswap-swap Edge Function — RETIRED (SWAP RETIRE-1). Answers 410 swap_retired.
//
// All logic is in handler.ts; this file only wires Deno and the auth check.
// The auth check uses the anon key on purpose: the retired endpoint needs no
// privileged access, so it never creates a service-role client.

import { createClient } from 'jsr:@supabase/supabase-js@2.117.2';
import { handleRetiredSwap } from './handler.ts';

Deno.serve(req => handleRetiredSwap(req, {
  isAuthenticated: async token => {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return !error && !!user;
  },
}));
