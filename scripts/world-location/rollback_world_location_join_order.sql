-- CLOUD JOIN-ORDER-2 — down migration for 20261006120000_world_location_join_order.sql.
--
-- NOT a versioned migration (outside supabase/migrations on purpose). It drops the two join-order
-- functions, the shape constraint and the three owner_page* columns; nothing else (the migration
-- changed no existing function, policy or privilege). Rows keep a coherent epoch and owner key: the
-- v1/v2 claims and saves never read the dropped columns.
--
-- Order (docs/design/CLOUD_JOIN_ORDER_2_REPORT.md §7): FIRST every realtime runs with WORLD_JOIN_ORDER
-- off/unset (a restart) or an older build; THEN world-authority goes back to the version without
-- location_claim_v3 (optional: a missing function already answers 501 and the realtime falls back);
-- ONLY THEN this script. It must run BEFORE rollback_world_presence_recovery.sql, which refuses while
-- these functions exist. Run as one unit:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/world-location/rollback_world_location_join_order.sql

BEGIN;
DROP FUNCTION IF EXISTS public.world_location_claim_keyed_v3(uuid, bigint, bigint, uuid, uuid, boolean, boolean, text, bigint);
DROP FUNCTION IF EXISTS public.world_location_join_order_version();
ALTER TABLE public.world_player_locations DROP CONSTRAINT IF EXISTS world_player_locations_owner_page_shape;
ALTER TABLE public.world_player_locations
  DROP COLUMN IF EXISTS owner_page_session,
  DROP COLUMN IF EXISTS owner_attempt,
  DROP COLUMN IF EXISTS owner_page;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('world_location_claim_keyed_v3', 'world_location_join_order_version'))
     OR EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'world_player_locations'
                AND column_name IN ('owner_page', 'owner_attempt', 'owner_page_session')) THEN
    RAISE EXCEPTION 'rollback incomplete: a join-order function or column is still present';
  END IF;
END;
$$;
COMMIT;
