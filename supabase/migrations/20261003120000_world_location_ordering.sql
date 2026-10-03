-- WORLD LOCATION-4 — distributed session ordering (design: docs/design/WORLD_LOCATION_4_DESIGN.md).
--
-- What this adds (additive; 20261001220000_world_player_locations.sql is not edited):
--
--   world_presence_hosts     one row per realtime PROCESS start: its generation (from a sequence)
--                            and a monotonic lifecycle  starting → active → draining → stopped.
--   world_presence_*()       acquire (creates 'starting'), activate (explicit, atomic), renew
--                            (never changes the state), drain, stop.
--   owner_* columns          the owner KEY of a location row: (owner_generation, owner_seq) of the
--                            session that holds it, plus that session's id.
--   world_location_claim_keyed(user, generation, seq, session, host)
--                            takes the row only for a strictly greater key, and only from an
--                            ACTIVE host with a live lease. Equal key + same session = adoption
--                            (a lost answer retried); smaller key = 'superseded' (final).
--   world_location_save_keyed(rows, generation, host)
--                            the v1 per-row CAS (epoch, seq) plus: the writer must own the row
--                            (owner_generation) and be active, or draining (final flush of rows it
--                            already owns), with a live lease.
--   v1 guards                world_location_claim / world_location_save (realtime 4d0ab64) only
--                            touch rows no keyed session owns (owner_generation = 0): the old
--                            protocol fails closed against keyed rows.
--
-- Time: only the database's now() is compared (leases). No realtime or client clock.
-- Trust boundary: RLS on with no policy on the new table; EVERY privilege is revoked explicitly
-- (Supabase's default privileges grant tables, sequences and functions in public to anon,
-- authenticated and service_role) and service_role gets back only what the functions need.
-- All functions are SECURITY INVOKER with a fixed search_path.
--
-- Rollback: scripts/world-location/rollback_world_location_ordering.sql.

-- ── Hosts: sequence, table, privileges ────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.world_presence_generation_seq AS bigint MINVALUE 1 NO CYCLE;

CREATE TABLE IF NOT EXISTS public.world_presence_hosts (
  generation       bigint      PRIMARY KEY DEFAULT nextval('public.world_presence_generation_seq'),
  host_id          uuid        NOT NULL UNIQUE,
  state            text        NOT NULL DEFAULT 'starting' CHECK (state IN ('starting', 'active', 'draining', 'stopped')),
  lease_expires_at timestamptz NOT NULL,
  -- Diagnostics only: never compared by any rule.
  created_at       timestamptz NOT NULL DEFAULT now(),
  activated_at     timestamptz NULL,
  draining_at      timestamptz NULL,
  stopped_at       timestamptz NULL
);
ALTER SEQUENCE public.world_presence_generation_seq OWNED BY public.world_presence_hosts.generation;
ALTER TABLE public.world_presence_hosts ENABLE ROW LEVEL SECURITY; -- no policy: no client ever

REVOKE ALL ON TABLE public.world_presence_hosts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.world_presence_generation_seq FROM PUBLIC, anon, authenticated, service_role;
-- No DELETE or TRUNCATE: stopped rows are pruned by hand (one row per process start).
GRANT SELECT, INSERT, UPDATE ON TABLE public.world_presence_hosts TO service_role;
-- USAGE = nextval (and currval), exactly what the DEFAULT above needs; no SELECT, no UPDATE (setval).
GRANT USAGE ON SEQUENCE public.world_presence_generation_seq TO service_role;

-- ── Owner key on the location row ─────────────────────────────────────────────

ALTER TABLE public.world_player_locations
  ADD COLUMN IF NOT EXISTS owner_generation bigint NOT NULL DEFAULT 0 CHECK (owner_generation >= 0),
  ADD COLUMN IF NOT EXISTS owner_seq        bigint NOT NULL DEFAULT 0 CHECK (owner_seq >= 0),
  ADD COLUMN IF NOT EXISTS owner_session    uuid   NULL;
-- world_player_locations keeps its privileges (SELECT, INSERT, UPDATE for service_role only).

-- ── Host lifecycle ───────────────────────────────────────────────────────────

-- acquire: a new process registers in 'starting'. Idempotent per host_id: a retry after a lost
-- answer returns the SAME generation and the CURRENT state, and never modifies an existing row.
CREATE OR REPLACE FUNCTION public.world_presence_acquire(p_host_id uuid, p_lease_ms integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v public.world_presence_hosts;
BEGIN
  IF p_host_id IS NULL OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN
    RAISE EXCEPTION 'invalid_acquire';
  END IF;
  INSERT INTO public.world_presence_hosts (host_id, lease_expires_at)
  VALUES (p_host_id, now() + make_interval(secs => p_lease_ms / 1000.0))
  ON CONFLICT (host_id) DO NOTHING;
  SELECT * INTO v FROM public.world_presence_hosts WHERE host_id = p_host_id;
  RETURN jsonb_build_object('generation', v.generation, 'state', v.state);
END;
$$;

-- activate: starting → active, explicit and atomic, once the process is ready to accept sessions.
-- Serialized (two candidates never activate at once) and refused while a NEWER host is active with
-- a live lease. It does NOT touch any older host: an older active host keeps its state until its
-- own renew/claim/save reports newerActive and it drains (bounded by its renew period + one RTT).
CREATE OR REPLACE FUNCTION public.world_presence_activate(p_generation bigint, p_host_id uuid, p_lease_ms integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v public.world_presence_hosts;
BEGIN
  IF p_generation IS NULL OR p_generation < 1 OR p_host_id IS NULL OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN
    RAISE EXCEPTION 'invalid_activate';
  END IF;
  -- Requires UPDATE on the table (service_role has it); does not conflict with FOR SHARE.
  LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'active' THEN RETURN jsonb_build_object('status', 'active'); END IF; -- a retry
  IF v.state <> 'starting' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', v.state); END IF;
  IF v.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired', 'state', v.state); END IF;
  IF EXISTS (SELECT 1 FROM public.world_presence_hosts h
              WHERE h.generation > p_generation AND h.state = 'active' AND h.lease_expires_at > now()) THEN
    RETURN jsonb_build_object('status', 'newer_active');
  END IF;
  UPDATE public.world_presence_hosts
     SET state = 'active', activated_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0)
   WHERE generation = p_generation AND state = 'starting';
  RETURN jsonb_build_object('status', 'active');
END;
$$;

-- renew: NEVER changes the state. starting and active extend their lease; an active host whose
-- lease ran out only revives if no newer host is active; draining is not extended (its flush
-- window was fixed by drain); stopped answers host_inactive.
CREATE OR REPLACE FUNCTION public.world_presence_renew(p_generation bigint, p_host_id uuid, p_lease_ms integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v       public.world_presence_hosts;
  v_newer boolean;
BEGIN
  IF p_generation IS NULL OR p_host_id IS NULL OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN
    RAISE EXCEPTION 'invalid_renew';
  END IF;
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'stopped' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', 'stopped'); END IF;
  IF v.state = 'starting' AND v.lease_expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'host_expired', 'state', 'starting');
  END IF;
  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts h
                      WHERE h.generation > p_generation AND h.state = 'active' AND h.lease_expires_at > now());
  IF v.state = 'starting' OR (v.state = 'active' AND NOT (v.lease_expires_at <= now() AND v_newer)) THEN
    UPDATE public.world_presence_hosts SET lease_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0)
     WHERE generation = p_generation AND state = v.state;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'state', v.state, 'newerActive', v_newer,
    'leaseLive', (SELECT lease_expires_at > now() FROM public.world_presence_hosts WHERE generation = p_generation));
END;
$$;

-- drain: active → draining with a fixed flush window (renew never extends it); starting → stopped
-- (a candidate that aborts). Idempotent.
CREATE OR REPLACE FUNCTION public.world_presence_drain(p_generation bigint, p_host_id uuid, p_drain_ms integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v public.world_presence_hosts;
BEGIN
  IF p_generation IS NULL OR p_host_id IS NULL OR p_drain_ms IS NULL OR p_drain_ms NOT BETWEEN 1000 AND 60000 THEN
    RAISE EXCEPTION 'invalid_drain';
  END IF;
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'active' THEN
    UPDATE public.world_presence_hosts
       SET state = 'draining', draining_at = now(), lease_expires_at = now() + make_interval(secs => p_drain_ms / 1000.0)
     WHERE generation = p_generation AND state = 'active';
    RETURN jsonb_build_object('status', 'ok', 'state', 'draining');
  ELSIF v.state = 'starting' THEN
    UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = now() WHERE generation = p_generation AND state = 'starting';
    RETURN jsonb_build_object('status', 'ok', 'state', 'stopped');
  ELSIF v.state = 'draining' THEN
    RETURN jsonb_build_object('status', 'ok', 'state', 'draining');
  END IF;
  RETURN jsonb_build_object('status', 'host_inactive', 'state', 'stopped');
END;
$$;

-- stop: any state → stopped (terminal). Idempotent.
CREATE OR REPLACE FUNCTION public.world_presence_stop(p_generation bigint, p_host_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_generation IS NULL OR p_host_id IS NULL THEN RAISE EXCEPTION 'invalid_stop'; END IF;
  UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = now()
   WHERE generation = p_generation AND host_id = p_host_id AND state <> 'stopped';
  IF NOT EXISTS (SELECT 1 FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id) THEN
    RETURN jsonb_build_object('status', 'unknown_host');
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'state', 'stopped');
END;
$$;

-- ── Keyed claim ──────────────────────────────────────────────────────────────
--
-- Returns { status: 'claimed', epoch, location, newerActive } | { status: 'superseded', newerActive }
--   | { status: 'host_inactive', state } | { status: 'host_expired' } | { status: 'unknown_host' }
--   | { status: 'unknown_user' }.
-- One statement takes the row: INSERT … ON CONFLICT DO UPDATE … WHERE key < new key. Two concurrent
-- claims serialize on the row and the second one evaluates its WHERE against the first's result.

CREATE OR REPLACE FUNCTION public.world_location_claim_keyed(
  p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  h       public.world_presence_hosts;
  v_row   public.world_player_locations;
  v_took  boolean;
  v_newer boolean;
BEGIN
  IF p_user_id IS NULL OR p_session IS NULL OR p_host_id IS NULL OR p_generation IS NULL OR p_generation < 1
     OR p_seq IS NULL OR p_seq < 1 THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  -- FOR SHARE: a concurrent drain/stop of this host waits for this claim, or the claim sees it.
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state <> 'active' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;

  BEGIN
    INSERT INTO public.world_player_locations (user_id, owner_generation, owner_seq, owner_session)
    VALUES (p_user_id, p_generation, p_seq, p_session)
    ON CONFLICT (user_id) DO UPDATE
       SET epoch = world_player_locations.epoch + 1, seq = 0, updated_at = now(),
           owner_generation = EXCLUDED.owner_generation, owner_seq = EXCLUDED.owner_seq, owner_session = EXCLUDED.owner_session
     WHERE (world_player_locations.owner_generation, world_player_locations.owner_seq)
           < (EXCLUDED.owner_generation, EXCLUDED.owner_seq)
    RETURNING * INTO v_row;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('status', 'unknown_user');
  END;
  v_took := FOUND; -- before any other statement
  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                      WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
  IF NOT v_took THEN
    SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id;
    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      -- The same key from another session is a caller bug (a key is one session's, for its life).
      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF;
      -- Adoption: the same claim retried after a lost answer: its epoch, unchanged.
    ELSE
      RETURN jsonb_build_object('status', 'superseded', 'newerActive', v_newer);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'claimed', 'epoch', v_row.epoch, 'newerActive', v_newer,
    'location', CASE WHEN v_row.area_id IS NULL THEN NULL ELSE jsonb_build_object(
      'areaId', v_row.area_id, 'tx', v_row.tx, 'ty', v_row.ty, 'layoutVersion', v_row.layout_version) END
  );
END;
$$;

-- ── Keyed save ───────────────────────────────────────────────────────────────
--
-- Host gate first (one answer for the whole batch): unknown_host | host_inactive (starting,
-- stopped) | host_expired (active or draining with a lease that ran out). Then, row by row, the
-- v1 rules plus ownership: a row is written only when epoch = stored epoch AND seq > stored seq
-- AND owner_generation = the writer's generation. For an active host the owner condition is
-- defence in depth (the epoch already names the owner); for a draining host it is what limits the
-- final flush to rows it still owns. Returns { status: 'ok', results: [{ userId, result }],
-- newerActive }; results as in v1: applied | duplicate | stale | invalid.

CREATE OR REPLACE FUNCTION public.world_location_save_keyed(p_rows jsonb, p_generation bigint, p_host_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  h         public.world_presence_hosts;
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
  v_newer   boolean;
BEGIN
  IF p_generation IS NULL OR p_generation < 1 OR p_host_id IS NULL THEN RAISE EXCEPTION 'invalid_writer'; END IF;
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state IN ('starting', 'stopped') THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired', 'state', h.state); END IF;

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
       WHERE user_id = v_user AND epoch = v_epoch AND seq < v_seq AND owner_generation = p_generation;
      IF FOUND THEN
        v_result := 'applied';
      ELSE
        SELECT * INTO v_stored FROM public.world_player_locations WHERE user_id = v_user;
        v_result := CASE WHEN NOT FOUND OR v_stored.epoch <> v_epoch OR v_stored.owner_generation <> p_generation
                         THEN 'stale' ELSE 'duplicate' END;
      END IF;
    END IF;
    v_results := v_results || jsonb_build_object(v_r.user_key, v_result);
  END LOOP;

  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                      WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
  RETURN jsonb_build_object(
    'status', 'ok', 'newerActive', v_newer,
    'results', (SELECT jsonb_agg(jsonb_build_object('userId', e ->> 'userId', 'result', v_results ->> lower(e ->> 'userId')) ORDER BY i)
                FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(e, i)));
END;
$$;

-- ── v1 guards (realtime 4d0ab64): only rows no keyed session owns ─────────────
-- Same bodies as 20261001220000 except the `owner_generation = 0` conditions, so the old
-- protocol fails closed against keyed rows: its claim answers 'conflict', its save 'stale'.

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
     WHERE user_id = p_user_id AND epoch = p_expected_epoch AND owner_generation = 0
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
       WHERE user_id = v_user AND epoch = v_epoch AND seq < v_seq AND owner_generation = 0;
      IF FOUND THEN
        v_result := 'applied';
      ELSE
        SELECT * INTO v_stored FROM public.world_player_locations WHERE user_id = v_user;
        v_result := CASE WHEN NOT FOUND OR v_stored.epoch <> v_epoch OR v_stored.owner_generation <> 0
                         THEN 'stale' ELSE 'duplicate' END;
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

-- ── Function privileges: explicit, never the defaults ─────────────────────────

REVOKE ALL ON FUNCTION public.world_presence_acquire(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_activate(bigint, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_renew(bigint, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_drain(bigint, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_stop(bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_location_claim_keyed(uuid, bigint, bigint, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_location_save_keyed(jsonb, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_location_claim(uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_location_save(jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.world_presence_acquire(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_activate(bigint, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_renew(bigint, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_drain(bigint, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_stop(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed(uuid, bigint, bigint, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_save_keyed(jsonb, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_claim(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_save(jsonb) TO service_role;
