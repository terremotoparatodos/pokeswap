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

# 2. The migrations under test, in the order hosted applies them (errors stop them; NOTICEs are printed):
#    the four RC-0.3 migrations, SWAP RETIRE-2, SECURITY-3, multi-yield (see the note below), then the
#    two WORLD LOCATION migrations. On a Windows checkout with core.autocrlf=true the files have CRLF;
#    `prepare.mjs migrate` (below) applies the same list with LF, as the blobs have it.
for m in 20260926001322_slots_client_write_revoke 20260926001502_market_require_session \
         20260926002154_world_skills_authority 20260926002207_world_skills_gate \
         20260930230308_retire_skip_swap_cooldown 20261001032040_security3_close_client_writes \
         20261001051958_world_multi_yield 20261001220000_world_player_locations \
         20261003120000_world_location_ordering; do
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
  node --test --test-concurrency=1 src/world/persistence/staging.test.js src/world/persistence/locationStaging.test.js
```

**WORLD LOCATION-2.** `locationStaging.test.js` uses the same variables: grants and RLS of
`world_player_locations` seen from PostgREST, the two operations through the served function, real
concurrent claims and overlapping batches, two journals and two room instances fencing each other,
the authority down at join and while saving, and the cascade on user deletion. Without Docker,
`node scripts/world-location/two-instances.mjs` runs two real realtime processes against the real
handler on an embedded Postgres (not a substitute for this stack: no PostgREST, Auth or Edge Runtime).

The tests refuse any `RC03_SUPABASE_URL` that is not `127.0.0.1` or `localhost`.

**WORLD LOCATION-4 F2.** The Q6 races of `locationStaging.test.js` cannot tell the ordering locks
apart (a plain race serializes whole functions). The deterministic regressions for them — barriers
confirmed in `pg_stat_activity`, independent connections, the RV1/RV2 negative controls — are a
separate battery: `scripts/world-location/postgres-concurrency/README.md`. Its `prepare.mjs` also
creates and migrates this stack (`init` without `--db-only`, then `migrate --build original`).

> ⚠️ **Migration order (YIELD-2 on top of SECURITY-3).** Hosted applied multi-yield individually
> after both security migrations and recorded it as `20261001051958`; the local file was renamed to
> `20261001051958_world_multi_yield.sql` (renamed from `20260928120000_world_multi_yield.sql`, same
> bytes). It is now the last version, so this loop's order is also version order.
>
> - **Never use `supabase db push`**: the local history is not reconciled with hosted
>   (`docs/BACKEND_INVENTORY.md`). A future migration is applied individually and its local file is
>   then aligned with the version hosted records (as SECURITY-3 did with `20261001032040`).

**Market after SECURITY-3.** No client (anon or signed-in) may execute `publish_market_listing`,
`cancel_market_listing` or `buy_market_listing`: the gate expects 42501 (HTTP 403 for a session) and
no effect. Tests that need an existing listing or a locked slot create it as a harness fixture with
this local stack's service key, never through a client path.
