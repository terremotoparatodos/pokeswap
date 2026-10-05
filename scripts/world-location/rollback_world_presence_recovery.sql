-- CLOUD READINESS-3 — down migration for 20261005120000_world_presence_recovery.sql.
--
-- NOT a versioned migration (outside supabase/migrations on purpose). It drops the five
-- recovery functions; nothing else (the migration created no table, column or index, and
-- changed no existing function). Data written through them stays valid for v1: a row taken by
-- claim v2 has a coherent epoch and owner key, and hosts created by a standby are ordinary rows.
--
-- Mandatory order (docs/design/CLOUD_READINESS_3_REPORT.md §6): FIRST every realtime runs with
-- WORLD_PRESENCE_RECOVERY unset/off (a restart) or an older build; THEN world-authority goes
-- back to v5; ONLY THEN this script. Run as one unit:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/world-location/rollback_world_presence_recovery.sql

BEGIN;
-- CLOUD JOIN-ORDER-2: claim v3 calls world_presence_owner_state (recovery rules); its rollback runs first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'world_location_claim_keyed_v3') THEN
    RAISE EXCEPTION 'rollback order: run rollback_world_location_join_order.sql first (nothing changed)';
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS public.world_presence_any_active();
DROP FUNCTION IF EXISTS public.world_presence_activate_exclusive(bigint, uuid, integer);
DROP FUNCTION IF EXISTS public.world_location_claim_keyed_v2(uuid, bigint, bigint, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.world_presence_owner_state(bigint);
DROP FUNCTION IF EXISTS public.world_presence_recovery_version();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('world_presence_any_active', 'world_presence_activate_exclusive',
                'world_location_claim_keyed_v2', 'world_presence_owner_state', 'world_presence_recovery_version')) THEN
    RAISE EXCEPTION 'rollback incomplete: a recovery function is still present';
  END IF;
END;
$$;
COMMIT;
