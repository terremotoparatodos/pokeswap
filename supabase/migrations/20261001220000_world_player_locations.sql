-- WORLD LOCATION-2 — authoritative player location (design: docs/design/WORLD_LOCATION_1_AUDIT.md).
--
-- What this adds:
--
--   world_player_locations   one row per player: the last shared area and tile the realtime
--                            server confirmed, the layout version of that area, and the CAS
--                            fence (epoch, seq). Not a game value: no XP, tokens or items.
--
--   world_location_claim(u)  a NEW session of a player: epoch + 1 and seq back to 0, in one
--                            statement. Returns the new epoch and the location as stored
--                            (the restore source). Any older session is fenced from here on.
--   world_location_save(r)   a batch (1–200) of { userId, epoch, seq, areaId, tx, ty,
--                            layoutVersion }. Each row is independent and answers
--                            'applied', 'duplicate', 'stale' or 'invalid'; one row's answer
--                            never decides another's.
--
-- CAS: a row is written only when epoch = stored epoch AND seq > stored seq.
--   applied    written;
--   duplicate  same epoch, seq <= stored: a retry or a reordered older batch (no change);
--   stale      no row, or another epoch: a newer session claimed; this writer is fenced;
--   invalid    the row's own shape is wrong (no change). The Edge Function refuses such a
--              batch before it gets here; this is defence in depth.
-- The epoch comes from this table and the seq from the realtime server's own counter: no
-- client value (and never the client-driven moveSequence) and no clock is ever compared.
--
-- Trust boundary: no client role reads or writes anything here. RLS is on with NO policy,
-- every client privilege is revoked, and both functions run SECURITY INVOKER with EXECUTE
-- for service_role only. The only production caller is the `world-authority` Edge Function.
--
-- Rollback: scripts/world-location/rollback_world_player_locations.sql (drops the two
-- functions and the table; the data is disposable). The realtime gate
-- WORLD_LOCATION_PERSISTENCE=off stops every call without touching the database.

-- ── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.world_player_locations (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  -- All four NULL: a claimed row with no location saved yet (restores as "no location").
  area_id        text        NULL CHECK (area_id ~ '^[a-z][a-z0-9-]{2,47}$'),
  tx             integer     NULL CHECK (tx BETWEEN -4096 AND 4095),
  ty             integer     NULL CHECK (ty BETWEEN -4096 AND 4095),
  layout_version text        NULL CHECK (layout_version ~ '^[a-z0-9.-]{1,32}$'),
  epoch          bigint      NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  seq            bigint      NOT NULL DEFAULT 0 CHECK (seq >= 0),
  -- Diagnostics only: never compared by any rule.
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT world_player_locations_all_or_none CHECK (
    (area_id IS NULL AND tx IS NULL AND ty IS NULL AND layout_version IS NULL) OR
    (area_id IS NOT NULL AND tx IS NOT NULL AND ty IS NOT NULL AND layout_version IS NOT NULL))
) WITH (fillfactor = 80); -- frequent updates by primary key only: room for HOT updates

-- ── Row level security and privileges ───────────────────────────────────────

ALTER TABLE public.world_player_locations ENABLE ROW LEVEL SECURITY;
-- No policy at all, on purpose: a client learns its own position from the realtime
-- server's snapshot and never anyone else's.

-- service_role too: Supabase's default privileges hand it ALL, and it needs only three.
REVOKE ALL ON TABLE public.world_player_locations FROM PUBLIC, anon, authenticated, service_role;
-- No DELETE or TRUNCATE: a row goes away only with its auth.users row (ON DELETE CASCADE,
-- which runs as the table owner, not as service_role).
GRANT SELECT, INSERT, UPDATE ON TABLE public.world_player_locations TO service_role;

-- ── world_location_claim ────────────────────────────────────────────────────
--
-- Returns { status: 'claimed', epoch, location: { areaId, tx, ty, layoutVersion } | null }
--      or { status: 'unknown_user' } when the id is not an auth user (nothing written).
-- One statement: two concurrent claims of the same player serialize on the row and get
-- two different epochs; the higher one is the only writer from then on.

CREATE OR REPLACE FUNCTION public.world_location_claim(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.world_player_locations;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unknown_user');
  END IF;

  -- The foreign key decides whether the user exists: service_role needs no access to auth.users.
  BEGIN
    INSERT INTO public.world_player_locations AS l (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO UPDATE SET epoch = l.epoch + 1, seq = 0, updated_at = now()
    RETURNING * INTO v_row;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('status', 'unknown_user');
  END;

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

REVOKE ALL ON FUNCTION public.world_location_claim(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.world_location_save(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.world_location_claim(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_save(jsonb) TO service_role;
