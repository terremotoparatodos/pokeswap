-- CLOUD READINESS-2 — PROTOTYPE ONLY (never a repo migration). Applied by run.mjs to the dedicated
-- local database `cr2_validation`, on top of the REAL migrations 20261001220000 and 20261003120000.
--
-- What it models (docs/design/CLOUD_READINESS_2_VALIDATION.md, "M0"):
--   world_location_owner_tabs           which page (tab id) holds the row's CURRENT owner session.
--                                       Valid only while owner_session matches the row's owner:
--                                       a v1 claim that takes the row silently invalidates it.
--   world_presence_owner_state(g)       'active' | 'draining' | 'unreachable' | 'stopped' | 'unknown'.
--                                       Read WITHOUT locking the owner's host row (see the doc).
--   world_location_claim_keyed_v2(...)  v1 + a decision table for a SMALLER key (no time grace).
--   world_presence_activate_exclusive   the standby's activation: refuses if any other host is
--                                       active, and YIELDS to a live starting host with a lower
--                                       generation (a deploy candidate still booting).
--   world_presence_any_active()         read-only probe.
--
-- Barrier hooks: cr2_hook(name) blocks on an advisory lock ONLY when the calling session set
-- `cr2.hooks` to a list containing name. A barrier session holds that lock; the test observes the
-- wait in pg_stat_activity, then releases it. No sleeps decide any order.
--
-- Mutants (run.mjs) replace exactly one marked fragment, in memory.

CREATE OR REPLACE FUNCTION public.cr2_hook(p_name text) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF position(',' || p_name || ',' IN ',' || coalesce(current_setting('cr2.hooks', true), '') || ',') > 0 THEN
    -- One barrier per (hook, session tag): two sessions paused at the same hook never serialize
    -- on each other.
    PERFORM pg_advisory_xact_lock(hashtext('cr2:' || p_name || ':' || coalesce(current_setting('cr2.tag', true), '')));
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cr2_hook(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.world_location_owner_tabs (
  user_id       uuid PRIMARY KEY REFERENCES public.world_player_locations (user_id) ON DELETE CASCADE,
  owner_session uuid NOT NULL,
  tab_id        text NOT NULL CHECK (tab_id ~ '^[A-Za-z0-9_-]{8,64}$')
);
ALTER TABLE public.world_location_owner_tabs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.world_location_owner_tabs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.world_location_owner_tabs TO service_role;

CREATE OR REPLACE FUNCTION public.world_presence_owner_state(p_generation bigint) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN h.state = 'active'   AND h.lease_expires_at >  now() THEN 'active'
      WHEN h.state = 'active'                                    THEN 'unreachable'
      WHEN h.state = 'draining' AND h.lease_expires_at >  now() THEN 'draining'
      WHEN h.state = 'draining'                                  THEN 'unreachable' /*MUT:draining-expired*/
      WHEN h.state = 'starting'                                  THEN 'stopped'     -- owns nothing
      ELSE 'stopped' END
    FROM public.world_presence_hosts h WHERE h.generation = p_generation), 'unknown')
$$;

CREATE OR REPLACE FUNCTION public.world_location_claim_keyed_v2(
  p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid,
  p_tab text, p_resume boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  h        public.world_presence_hosts;
  v_row    public.world_player_locations;
  v_took   boolean;
  v_newer  boolean;
  v_state  text := null;
  v_same   boolean := false;
  v_answer text := null;
BEGIN
  IF p_user_id IS NULL OR p_session IS NULL OR p_host_id IS NULL OR p_generation IS NULL OR p_generation < 1
     OR p_seq IS NULL OR p_seq < 1 OR p_resume IS NULL
     OR (p_tab IS NOT NULL AND p_tab !~ '^[A-Za-z0-9_-]{8,64}$') THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  -- Caller host gate: unchanged from v1 (FOR SHARE: a concurrent drain/stop of THIS host waits).
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE; /*MUT:caller-share*/
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state <> 'active' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;
  PERFORM public.cr2_hook('after_host');

  -- 1. A strictly greater key takes the row exactly as v1.
  BEGIN
    INSERT INTO public.world_player_locations (user_id, owner_generation, owner_seq, owner_session)
    VALUES (p_user_id, p_generation, p_seq, p_session)
    ON CONFLICT (user_id) DO UPDATE
       SET epoch = world_player_locations.epoch + 1, seq = 0, updated_at = now(),
           owner_generation = EXCLUDED.owner_generation, owner_seq = EXCLUDED.owner_seq, owner_session = EXCLUDED.owner_session
     WHERE (world_player_locations.owner_generation, world_player_locations.owner_seq) < (EXCLUDED.owner_generation, EXCLUDED.owner_seq)
    RETURNING * INTO v_row;
  EXCEPTION WHEN foreign_key_violation THEN RETURN jsonb_build_object('status', 'unknown_user');
  END;
  v_took := FOUND;

  IF NOT v_took THEN
    -- 2. Smaller (or equal) key: lock the row, then decide on the owner's state.
    SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id FOR UPDATE;
    PERFORM public.cr2_hook('after_row');
    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF;
      -- adoption (a lost answer retried): v1
    ELSE
      /*MUT:owner-share*/
      v_state := public.world_presence_owner_state(v_row.owner_generation);
      v_same := p_tab IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.world_location_owner_tabs t
         WHERE t.user_id = p_user_id AND t.tab_id = p_tab
           AND t.owner_session = v_row.owner_session /*MUT:tab-session*/);
      PERFORM public.cr2_hook('after_state');
      IF v_state = 'draining' THEN v_answer := 'owner_draining'; /*MUT:draining-takes*/
      ELSIF v_same OR v_state IN ('stopped', 'unknown') THEN v_answer := null;           -- take
      ELSIF v_state = 'unreachable' AND NOT p_resume THEN v_answer := null;              -- explicit replace
      ELSIF v_state = 'unreachable' THEN v_answer := 'owner_unreachable'; /*MUT:unreachable-takes*/
      ELSE v_answer := 'superseded';                                                     -- live owner, other tab
      END IF;
      IF v_answer IS NOT NULL THEN
        v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                            WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
        RETURN jsonb_build_object('status', v_answer, 'newerActive', v_newer, 'ownerState', v_state);
      END IF;
      UPDATE public.world_player_locations
         SET epoch = epoch + 1, seq = 0, updated_at = now(),
             owner_generation = p_generation, owner_seq = p_seq, owner_session = p_session
       WHERE user_id = p_user_id
      RETURNING * INTO v_row;
      v_took := true;
    END IF;
  END IF;

  IF v_took THEN
    IF p_tab IS NULL THEN
      DELETE FROM public.world_location_owner_tabs WHERE user_id = p_user_id;
    ELSE
      INSERT INTO public.world_location_owner_tabs (user_id, owner_session, tab_id) VALUES (p_user_id, p_session, p_tab)
      ON CONFLICT (user_id) DO UPDATE SET owner_session = EXCLUDED.owner_session, tab_id = EXCLUDED.tab_id;
    END IF;
  END IF;
  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                      WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
  RETURN jsonb_build_object('status', 'claimed', 'epoch', v_row.epoch, 'newerActive', v_newer, 'ownerState', v_state,
    'location', CASE WHEN v_row.area_id IS NULL THEN NULL ELSE jsonb_build_object(
      'areaId', v_row.area_id, 'tx', v_row.tx, 'ty', v_row.ty, 'layoutVersion', v_row.layout_version) END);
END;
$$;

CREATE OR REPLACE FUNCTION public.world_presence_activate_exclusive(p_generation bigint, p_host_id uuid, p_lease_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.world_presence_hosts;
BEGIN
  IF p_generation IS NULL OR p_generation < 1 OR p_host_id IS NULL OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 120000 THEN
    RAISE EXCEPTION 'invalid_activate';
  END IF;
  LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE; /*MUT:excl-lock*/
  PERFORM public.cr2_hook('excl_after_lock');
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'active' THEN RETURN jsonb_build_object('status', 'active'); END IF;
  IF v.state <> 'starting' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', v.state); END IF;
  IF v.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;
  IF EXISTS (SELECT 1 FROM public.world_presence_hosts o
              WHERE o.generation <> p_generation AND o.state = 'active' AND o.lease_expires_at > now()) THEN
    RETURN jsonb_build_object('status', 'other_active');
  END IF;
  IF EXISTS (SELECT 1 FROM public.world_presence_hosts o /*MUT:yield*/
              WHERE o.generation < p_generation AND o.state = 'starting' AND o.lease_expires_at > now()) THEN
    RETURN jsonb_build_object('status', 'candidate_starting');
  END IF;
  PERFORM public.cr2_hook('excl_after_check');
  UPDATE public.world_presence_hosts
     SET state = 'active', activated_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0)
   WHERE generation = p_generation AND state = 'starting';
  RETURN jsonb_build_object('status', 'active');
END;
$$;

CREATE OR REPLACE FUNCTION public.world_presence_any_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.world_presence_hosts WHERE state = 'active' AND lease_expires_at > now())
$$;

REVOKE ALL ON FUNCTION public.world_presence_owner_state(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_location_claim_keyed_v2(uuid, bigint, bigint, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_activate_exclusive(bigint, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_any_active() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_owner_state(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed_v2(uuid, bigint, bigint, uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_activate_exclusive(bigint, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_any_active() TO service_role;
