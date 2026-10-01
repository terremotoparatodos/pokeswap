-- SECURITY-3: close the remaining client write paths.
--
-- 1. pokemon_xp and pokedex_entries: hosted lets a signed-in user INSERT,
--    UPDATE and DELETE their own rows, so XP, levels, moves and the Pokédex
--    are client-authoritative. INSERT, UPDATE, DELETE and TRUNCATE are revoked
--    from PUBLIC, anon and authenticated. SELECT is not touched.
-- 2. Market RPCs (buy/publish/cancel_market_listing): the market is unused in
--    Playtest 0.2 and must be redesigned around Pokémon instances (with an
--    ownership compare-and-set) before it returns. EXECUTE is revoked from
--    PUBLIC, anon and authenticated.
-- 3. Latent RPCs from migrations 005/008/009 (grant_pokemon_xp,
--    spend_tokens_learn_move, register_pokemon, record_pokemon_seen,
--    bulk_record_pokemon_seen, collect_passive_tokens): absent from hosted
--    today, but a fresh install from this repository creates them and grants
--    them to authenticated. Wherever they exist, EXECUTE is revoked from
--    PUBLIC, anon and authenticated. They are never created here.
-- 4. Dungeon RPCs from migrations 010/011 (award_dungeon_reward,
--    consume_dungeon_energy): absent from production, and neither the
--    dungeon-reward nor the dungeon-start Edge Function is deployed. A fresh
--    install creates them and grants them to authenticated; award_dungeon_reward
--    takes client-supplied XP and token amounts. Closed preventively, exactly
--    like the latent RPCs. Dungeon must reintroduce server-side authority in a
--    later phase; these functions must never be granted to authenticated.
--
-- Additive and non-destructive on purpose:
--   - no table, column, row, function body, policy or comment is created,
--     altered or dropped; no XP, Pokédex, slot, listing, token or ledger row
--     is touched;
--   - functions are found in the catalog by name, so every real overload is
--     revoked by its actual signature and a missing one is simply skipped;
--     a missing table is skipped too;
--   - postgres and service_role keep exactly what they had: if one of them
--     only held a privilege through PUBLIC, it is granted back to that role
--     directly (the only GRANT this migration can issue);
--   - re-running it is harmless.
--
-- Historical migrations 005/008/009/010/011 still contain their GRANTs; this one runs
-- after them and leaves the final state closed. The guard in
-- services/realtime/src/migrations/security3ClientGrants.test.js fails if any
-- other migration grants these objects back to clients.
--
-- Rollback (administrative only; do not re-grant to clients while the market
-- and progression lack server authority):
--   GRANT EXECUTE ON FUNCTION <signature> TO authenticated;
--   GRANT INSERT, UPDATE, DELETE ON TABLE public.pokemon_xp, public.pokedex_entries TO authenticated;

DO $$
DECLARE
  keepers  constant text[] := ARRAY['postgres', 'service_role'];
  dml      constant text[] := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  closed_fns constant text[] := ARRAY[
    'buy_market_listing', 'publish_market_listing', 'cancel_market_listing',
    'grant_pokemon_xp', 'spend_tokens_learn_move', 'register_pokemon',
    'record_pokemon_seen', 'bulk_record_pokemon_seen', 'collect_passive_tokens',
    'award_dungeon_reward', 'consume_dungeon_energy'
  ];
  tbl      text;
  rel      regclass;
  fn       regprocedure;
  keeper   text;
  priv     text;
  held     text[];
  n_tables integer := 0;
  n_fns    integer := 0;
BEGIN
  -- ── Tables ────────────────────────────────────────────────────────────────
  FOREACH tbl IN ARRAY ARRAY['pokemon_xp', 'pokedex_entries'] LOOP
    rel := to_regclass(format('public.%I', tbl));
    IF rel IS NULL THEN
      RAISE NOTICE 'SECURITY-3: public.% does not exist, skipped', tbl;
      CONTINUE;
    END IF;

    -- What each keeper holds before, as 'role|PRIVILEGE'.
    held := ARRAY(SELECT k || '|' || p
                  FROM unnest(keepers) k, unnest(dml) p
                  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = k)
                    AND has_table_privilege(k, rel, p));
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE %s FROM PUBLIC, anon, authenticated', rel);
    FOREACH priv IN ARRAY held LOOP
      keeper := split_part(priv, '|', 1);
      IF NOT has_table_privilege(keeper, rel, split_part(priv, '|', 2)) THEN
        EXECUTE format('GRANT %s ON TABLE %s TO %I', split_part(priv, '|', 2), rel, keeper);
      END IF;
    END LOOP;
    n_tables := n_tables + 1;
  END LOOP;

  -- ── Functions: every real overload of every listed name ──────────────────
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (closed_fns)
    ORDER BY p.proname, p.oid
  LOOP
    held := ARRAY(SELECT k FROM unnest(keepers) k
                  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = k)
                    AND has_function_privilege(k, fn, 'EXECUTE'));
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    FOREACH keeper IN ARRAY held LOOP
      IF NOT has_function_privilege(keeper, fn, 'EXECUTE') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, keeper);
      END IF;
    END LOOP;
    n_fns := n_fns + 1;
  END LOOP;

  RAISE NOTICE 'SECURITY-3: client DML revoked on % table(s); client EXECUTE revoked on % function overload(s)', n_tables, n_fns;
END $$;
