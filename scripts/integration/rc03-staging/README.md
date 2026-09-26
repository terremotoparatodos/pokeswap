# RC-0.3 staging (LOCAL ONLY)

A local Supabase stack (Postgres 17.6, PostgREST, Auth, Edge Runtime) that mirrors
the production objects deciding Pokémon ownership, plus the WORLD × SKILLS
migration, for `services/realtime/src/world/persistence/staging.test.js`.

**Never apply these files to a remote project.** They are outside
`supabase/migrations` on purpose, so `supabase db push` cannot pick them up.

- `01_prod_mirror.sql` holds the schema, RLS, policies and ACLs of `pokemon`, `profiles`, `slots`,
  `market_listings`, `transactions`, `token_ledger` and `activity_feed`. They were read from the
  production catalog (read-only) on 2026-09-25. No data comes from production: only placeholder
  Pokémon rows are inserted.
- `02_prod_mirror_functions.sql` holds the functions that write `slots`, with their production ACLs.
  `claim_slot` and `confirm_payment` are stand-ins that *would* hand a slot over, so a client refusal
  proves the ACL.

```bash
# 1. Docker running (its disk must have room: ~5 GB of images).
mkdir -p stage && cd stage && supabase init --force
mkdir -p supabase/functions && cp -r ../supabase/functions/world-authority supabase/functions/
cp ../scripts/integration/rc03-staging/01_prod_mirror.sql supabase/migrations/20260101000000_prod_mirror.sql
cp ../scripts/integration/rc03-staging/02_prod_mirror_functions.sql supabase/migrations/20260101000001_prod_mirror_functions.sql
supabase start -x studio,imgproxy,vector,logflare,mailpit,realtime,storage-api,postgres-meta,supavisor

# 2. The migrations under test, in production order (errors stop them; NOTICEs are printed).
for m in 20260926001322_slots_client_write_revoke 20260926001502_market_require_session \
         20260926002154_world_skills_authority 20260926002207_world_skills_gate; do
  docker exec -i supabase_db_stage psql -U postgres -v ON_ERROR_STOP=1 --single-transaction -f - \
    < ../supabase/migrations/$m.sql
done

# 3. The function with a throwaway secret.
node -e "console.log('WORLD_AUTHORITY_SECRET='+require('crypto').randomBytes(36).toString('base64url'))" > functions.env
supabase functions serve --no-verify-jwt --env-file functions.env &

# 4. The gate (local keys from `supabase status -o env`).
supabase status -o env > local.env; set -a; . ./local.env; . ./functions.env; set +a
cd ../services/realtime && RC03_SUPABASE_URL=http://127.0.0.1:54321 RC03_ANON_KEY="$ANON_KEY" \
  RC03_SERVICE_KEY="$SERVICE_ROLE_KEY" RC03_AUTHORITY_SECRET="$WORLD_AUTHORITY_SECRET" RC03_JWT_SECRET="$JWT_SECRET" \
  node --test --test-concurrency=1 src/world/persistence/staging.test.js
```

The tests refuse any `RC03_SUPABASE_URL` that is not `127.0.0.1` or `localhost`.
