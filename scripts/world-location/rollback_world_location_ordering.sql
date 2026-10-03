-- WORLD LOCATION-4 — down migration for 20261003120000_world_location_ordering.sql.
--
-- NOT a versioned migration (outside supabase/migrations on purpose, so `supabase db push`
-- never picks it up). Run it by hand only if the keyed ordering is abandoned, AFTER every
-- realtime runs a version that no longer calls the keyed operations (or with
-- WORLD_LOCATION_PERSISTENCE=off) and world-authority no longer exposes them.
--
-- It restores the v1 bodies of world_location_claim / world_location_save exactly as
-- 20261001220000 defined them (they must not reference owner_* once those columns are gone),
-- then drops the keyed functions, the owner columns, the hosts table and its sequence.
-- The data is disposable. The PGlite test (worldLocationOrdering.database.test.js) runs this file.

DROP FUNCTION IF EXISTS public.world_location_save_keyed(jsonb, bigint, uuid);
DROP FUNCTION IF EXISTS public.world_location_claim_keyed(uuid, bigint, bigint, uuid, uuid);
DROP FUNCTION IF EXISTS public.world_presence_stop(bigint, uuid);
DROP FUNCTION IF EXISTS public.world_presence_drain(bigint, uuid, integer);
DROP FUNCTION IF EXISTS public.world_presence_renew(bigint, uuid, integer);
DROP FUNCTION IF EXISTS public.world_presence_activate(bigint, uuid, integer);
DROP FUNCTION IF EXISTS public.world_presence_acquire(uuid, integer);

-- ── v1 bodies, verbatim from 20261001220000 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.world_location_claim(p_user_id uuid, p_expected_epoch bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row     public.world_player_locations;
  v_current bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unknown_user');
  END IF;
  IF p_expected_epoch IS NULL OR p_expected_epoch < 0 THEN
    RAISE EXCEPTION 'invalid_expected_epoch';
  END IF;

  IF p_expected_epoch = 0 THEN
    -- The foreign key decides whether the user exists: service_role needs no access to auth.users.
    BEGIN
      INSERT INTO public.world_player_locations (user_id) VALUES (p_user_id)
      ON CONFLICT (user_id) DO NOTHING
      RETURNING * INTO v_row;
    EXCEPTION WHEN foreign_key_violation THEN
      RETURN jsonb_build_object('status', 'unknown_user');
    END;
  ELSE
    UPDATE public.world_player_locations
       SET epoch = epoch + 1, seq = 0, updated_at = now()
     WHERE user_id = p_user_id AND epoch = p_expected_epoch
    RETURNING * INTO v_row;
  END IF;

  IF NOT FOUND THEN
    SELECT epoch INTO v_current FROM public.world_player_locations WHERE user_id = p_user_id;
    RETURN jsonb_build_object('status', 'conflict', 'epoch', COALESCE(v_current, 0));
  END IF;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'epoch', v_row.epoch,
    'location', CASE WHEN v_row.area_id IS NULL THEN NULL ELSE jsonb_build_object(
      'areaId', v_row.area_id, 'tx', v_row.tx, 'ty', v_row.ty, 'layoutVersion', v_row.layout_version) END
  );
END;
$$;

-- ── world_location_save ─────────────────────────────────────────────────────
--
-- p_rows: [{ "userId", "epoch", "seq", "areaId", "tx", "ty", "layoutVersion" }], 1–200 rows,
--         one per player. Returns [{ "userId", "result" }], one per row, in input order.
-- Rows are written in user_id order, so two concurrent batches never deadlock.
-- A malformed batch (not an array, empty, > 200, a repeated or missing userId) raises:
-- that is a caller bug, and nothing is written.

CREATE OR REPLACE FUNCTION public.world_location_save(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count   integer;
  v_r       record;
  v_user    uuid;
  v_epoch   bigint;
  v_seq     bigint;
  v_tx      bigint;
  v_ty      bigint;
  v_stored  public.world_player_locations;
  v_result  text;
  v_results jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count < 1 OR v_count > 200 THEN RAISE EXCEPTION 'invalid_batch_size'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) e
             WHERE jsonb_typeof(e) IS DISTINCT FROM 'object' OR (e ->> 'userId') IS NULL
                OR (e ->> 'userId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'invalid_batch_user';
  END IF;
  IF (SELECT count(DISTINCT lower(e ->> 'userId')) FROM jsonb_array_elements(p_rows) e) <> v_count THEN
    RAISE EXCEPTION 'duplicate_batch_user';
  END IF;

  FOR v_r IN
    SELECT e AS row, lower(e ->> 'userId') AS user_key
    FROM jsonb_array_elements(p_rows) e
    ORDER BY lower(e ->> 'userId')
  LOOP
    v_user := (v_r.user_key)::uuid;
    v_result := NULL;

    -- Shape, row by row: an invalid row is answered 'invalid' and changes nothing.
    -- IS DISTINCT FROM, not <>: a missing key gives NULL, and NULL must count as invalid.
    -- Once every type matches, every ->> below is non-NULL, so the regex tests are too.
    IF jsonb_typeof(v_r.row -> 'epoch') IS DISTINCT FROM 'number' OR jsonb_typeof(v_r.row -> 'seq') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_r.row -> 'tx') IS DISTINCT FROM 'number' OR jsonb_typeof(v_r.row -> 'ty') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_r.row -> 'areaId') IS DISTINCT FROM 'string' OR jsonb_typeof(v_r.row -> 'layoutVersion') IS DISTINCT FROM 'string'
       OR (v_r.row ->> 'epoch') !~ '^[0-9]{1,16}$' OR (v_r.row ->> 'seq') !~ '^[0-9]{1,16}$'
       OR (v_r.row ->> 'tx') !~ '^-?[0-9]{1,5}$' OR (v_r.row ->> 'ty') !~ '^-?[0-9]{1,5}$'
       OR (v_r.row ->> 'areaId') !~ '^[a-z][a-z0-9-]{2,47}$'
       OR (v_r.row ->> 'layoutVersion') !~ '^[a-z0-9.-]{1,32}$' THEN
      v_result := 'invalid';
    ELSE
      v_epoch := (v_r.row ->> 'epoch')::bigint;
      v_seq   := (v_r.row ->> 'seq')::bigint;
      v_tx    := (v_r.row ->> 'tx')::bigint;
      v_ty    := (v_r.row ->> 'ty')::bigint;
      IF v_epoch < 1 OR v_seq < 1 OR v_tx NOT BETWEEN -4096 AND 4095 OR v_ty NOT BETWEEN -4096 AND 4095 THEN
        v_result := 'invalid';
      END IF;
    END IF;

    IF v_result IS NULL THEN
      UPDATE public.world_player_locations
         SET area_id = v_r.row ->> 'areaId', tx = v_tx::integer, ty = v_ty::integer,
             layout_version = v_r.row ->> 'layoutVersion', seq = v_seq, updated_at = now()
       WHERE user_id = v_user AND epoch = v_epoch AND seq < v_seq;
      IF FOUND THEN
        v_result := 'applied';
      ELSE
        SELECT * INTO v_stored FROM public.world_player_locations WHERE user_id = v_user;
        v_result := CASE WHEN NOT FOUND OR v_stored.epoch <> v_epoch THEN 'stale' ELSE 'duplicate' END;
      END IF;
    END IF;

    v_results := v_results || jsonb_build_object(v_r.user_key, v_result);
  END LOOP;

  RETURN (
    SELECT jsonb_agg(jsonb_build_object('userId', e ->> 'userId', 'result', v_results ->> lower(e ->> 'userId')) ORDER BY i)
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(e, i)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.world_location_claim(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.world_location_save(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.world_location_claim(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_save(jsonb) TO service_role;

-- ── Keyed ownership and hosts ────────────────────────────────────────────────
ALTER TABLE public.world_player_locations
  DROP COLUMN IF EXISTS owner_session,
  DROP COLUMN IF EXISTS owner_seq,
  DROP COLUMN IF EXISTS owner_generation;
DROP TABLE IF EXISTS public.world_presence_hosts; -- its OWNED BY sequence goes with it
DROP SEQUENCE IF EXISTS public.world_presence_generation_seq;
