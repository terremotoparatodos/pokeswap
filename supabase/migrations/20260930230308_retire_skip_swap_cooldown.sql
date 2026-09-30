-- SWAP RETIRE-2: skip_swap_cooldown is no longer callable by any client.
--
-- Swap is retired (pokeswap-swap answers 410 swap_retired since SWAP RETIRE-1).
-- skip_swap_cooldown still debited 1,000 tokens to clear a cooldown that no
-- longer guards anything: a client could burn its balance for nothing. This
-- takes EXECUTE away from PUBLIC, anon and authenticated.
--
-- Additive and non-destructive on purpose:
--   - the function is NOT dropped or rewritten: it stays for traceability and
--     for an administrative rollback (re-grant) only;
--   - no table, column, row, cooldown, swap_history or token_ledger entry is
--     touched, and nothing is charged or refunded;
--   - service_role and the owner keep whatever they already had.
--
-- The versioned definitions are all `public.skip_swap_cooldown()`, but hosted
-- predates this repository's migrations, so every overload that actually
-- exists is revoked by its real signature from the catalog — none is assumed.
-- Re-running it is harmless. Cleanup of the function, the cooldown column and
-- the history waits for INSTANCES-1 and its backfill.

DO $$
DECLARE
  fn regprocedure;
  revoked integer := 0;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'skip_swap_cooldown'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format(
      'COMMENT ON FUNCTION %s IS %L', fn,
      'RETIRED (SWAP RETIRE-2): Swap is retired. Not executable by PUBLIC, anon or authenticated. '
      || 'Kept only for traceability and administrative rollback; do not re-grant to clients.'
    );
    revoked := revoked + 1;
  END LOOP;
  RAISE NOTICE 'skip_swap_cooldown: % overload(s) revoked from PUBLIC, anon, authenticated', revoked;
END $$;
