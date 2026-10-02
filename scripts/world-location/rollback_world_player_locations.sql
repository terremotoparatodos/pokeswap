-- WORLD LOCATION-2 — down migration for 20261001220000_world_player_locations.sql.
--
-- NOT a versioned migration (it lives outside supabase/migrations on purpose, so
-- `supabase db push` can never pick it up). Run it by hand, only if the feature is
-- abandoned, AFTER the realtime runs with WORLD_LOCATION_PERSISTENCE=off and the
-- world-authority function no longer exposes location_claim / location_save.
--
-- The data is disposable: losing it only means players start in Ciudad again.
-- The PGlite test (worldLocations.database.test.js) runs this exact file.

DROP FUNCTION IF EXISTS public.world_location_save(jsonb);
DROP FUNCTION IF EXISTS public.world_location_claim(uuid, bigint);
DROP TABLE IF EXISTS public.world_player_locations;
