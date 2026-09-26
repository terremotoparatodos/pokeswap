// world-authority Edge Function (INTEGRATION-1). Deployed in the RC-0.3 dark launch.
//
// Deploy only after review, with the secret set first:
//   supabase secrets set WORLD_AUTHORITY_SECRET=<48+ random chars>
//   supabase functions deploy world-authority --no-verify-jwt
// (--no-verify-jwt: the caller is the realtime server, not a signed-in user;
// the secret is the authentication. The same secret goes into the realtime
// service's env as WORLD_AUTHORITY_SECRET, never into a frontend env.)
//
// All logic is in handler.ts; this file only wires Deno and the service role.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleWorldAuthority } from './handler.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(req => handleWorldAuthority(req, {
  secret: Deno.env.get('WORLD_AUTHORITY_SECRET'),
  rpc: async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) console.error('world-authority rpc failed', fn, error.code ?? '');
    return { data, error: error ? { message: error.message } : null };
  },
}));
