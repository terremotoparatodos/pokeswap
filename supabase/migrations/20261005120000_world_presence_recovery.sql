-- CLOUD READINESS-3 — presence recovery (docs/design/CLOUD_READINESS_3_REPORT.md; validated design:
-- docs/design/CLOUD_READINESS_2_VALIDATION.md on validation/cloud-readiness-2, minus the same-page
-- rule, which the real reconnection contract does not support).
--
-- Additive only: no table, column, index or existing function changes. The v1 functions of
-- 20261001220000 and 20261003120000 keep their bodies, privileges and answers; a realtime that
-- never calls the functions below sees no difference.
--
--   world_presence_recovery_version()   1. The capability marker: world-authority answers its
--                                       'capabilities' op from it (never from its own version).
--   world_presence_owner_state(g)       how the host that owns a row stands, by the database's
--                                       now() only. Read WITHOUT locking that host (see claim v2).
--   world_location_claim_keyed_v2(...)  the keyed claim (v1) plus a decision for a SMALLER key:
--                                         owner active (live lease)  → 'superseded' (as v1)
--                                         owner draining (live)      → 'owner_draining' (retryable)
--                                         owner active or draining whose lease ran out
--                                                                    → 'owner_unreachable' (retryable),
--                                                                      or taken ONLY by an explicit
--                                                                      takeover («Jugar acá»)
--                                         owner stopped, starting or unknown → taken (its sockets
--                                                                      were closed before it stopped)
--                                       No takeover is ever decided by a lease expiry alone.
--   world_presence_activate_exclusive   a standby's activation with a NEW identity: refused while
--                                       any other host is active ('other_active'), and yields to
--                                       a live starting host of a LOWER generation (a deploy
--                                       candidate still booting: 'candidate_starting').
--   world_presence_any_active()         read-only probe for the standby.
--
-- `-- @hook <name>` lines are comments: the Postgres concurrency battery
-- (scripts/world-location/recovery-concurrency) injects its barriers there IN MEMORY.
-- Rollback: scripts/world-location/rollback_world_presence_recovery.sql.

CREATE OR REPLACE FUNCTION public.world_presence_recovery_version()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$ SELECT 1 $$;

CREATE OR REPLACE FUNCTION public.world_presence_owner_state(p_generation bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN h.state = 'active'   AND h.lease_expires_at > now() THEN 'active'
      WHEN h.state = 'draining' AND h.lease_expires_at > now() THEN 'draining'
      WHEN h.state IN ('active', 'draining')                      THEN 'unreachable'
      ELSE 'stopped' -- stopped, or starting (a starting host never owned a row)
    END
    FROM public.world_presence_hosts h WHERE h.generation = p_generation), 'unknown')
$$;

CREATE OR REPLACE FUNCTION public.world_location_claim_keyed_v2(
  p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid, p_takeover boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  h        public.world_presence_hosts;
  v_row    public.world_player_locations;
  v_took   boolean;
  v_newer  boolean;
  v_state  text := NULL;
  v_answer text := NULL;
BEGIN
  IF p_user_id IS NULL OR p_session IS NULL OR p_host_id IS NULL OR p_generation IS NULL OR p_generation < 1
     OR p_seq IS NULL OR p_seq < 1 OR p_takeover IS NULL THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  -- The caller's host gate, exactly as v1 (FOR SHARE: a concurrent drain/stop of THIS host waits).
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state <> 'active' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;
  -- @hook after_host

  -- A strictly greater key takes the row exactly as v1.
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
  v_took := FOUND;

  IF NOT v_took THEN
    -- The row exists with a greater or equal key: lock it, then decide on its owner's state.
    SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id FOR UPDATE;
    -- @hook after_row
    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      -- Adoption (a lost answer retried), as v1.
      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF;
    ELSE
      -- Not locked on purpose: every transition that can happen meanwhile (active → draining →
      -- stopped, a lease running out, a renew reviving an expired lease) can only turn a takeover
      -- below into a retryable answer, never the other way round, because only 'stopped'/'unknown'
      -- (terminal) or an explicit takeover take the row.
      v_state := public.world_presence_owner_state(v_row.owner_generation);
      -- @hook after_state
      IF v_state = 'draining' THEN
        v_answer := 'owner_draining';
      ELSIF v_state IN ('stopped', 'unknown') THEN
        v_answer := NULL;
      ELSIF v_state = 'unreachable' THEN
        v_answer := CASE WHEN p_takeover THEN NULL ELSE 'owner_unreachable' END;
      ELSE
        v_answer := 'superseded';
      END IF;
      IF v_answer IS NOT NULL THEN
        v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                            WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
        RETURN jsonb_build_object('status', v_answer, 'newerActive', v_newer);
      END IF;
      UPDATE public.world_player_locations
         SET epoch = epoch + 1, seq = 0, updated_at = now(),
             owner_generation = p_generation, owner_seq = p_seq, owner_session = p_session
       WHERE user_id = p_user_id
      RETURNING * INTO v_row;
    END IF;
  END IF;

  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                      WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
  RETURN jsonb_build_object(
    'status', 'claimed', 'epoch', v_row.epoch, 'newerActive', v_newer,
    'location', CASE WHEN v_row.area_id IS NULL THEN NULL ELSE jsonb_build_object(
      'areaId', v_row.area_id, 'tx', v_row.tx, 'ty', v_row.ty, 'layoutVersion', v_row.layout_version) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.world_presence_activate_exclusive(p_generation bigint, p_host_id uuid, p_lease_ms integer)
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
  -- The same lock as world_presence_activate: both activations, and the drain/stop/renew updates,
  -- serialize on it (the answer is always the state it found: no TOCTOU).
  LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE;
  -- @hook excl_after_lock
  SELECT * INTO v FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF v.state = 'active' THEN RETURN jsonb_build_object('status', 'active'); END IF; -- a retry
  IF v.state <> 'starting' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', v.state); END IF;
  IF v.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired', 'state', v.state); END IF;
  IF EXISTS (SELECT 1 FROM public.world_presence_hosts o
              WHERE o.generation <> p_generation AND o.state = 'active' AND o.lease_expires_at > now()) THEN
    RETURN jsonb_build_object('status', 'other_active');
  END IF;
  IF EXISTS (SELECT 1 FROM public.world_presence_hosts o
              WHERE o.generation < p_generation AND o.state = 'starting' AND o.lease_expires_at > now()) THEN
    RETURN jsonb_build_object('status', 'candidate_starting');
  END IF;
  -- @hook excl_after_check
  UPDATE public.world_presence_hosts
     SET state = 'active', activated_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_ms / 1000.0)
   WHERE generation = p_generation AND state = 'starting';
  RETURN jsonb_build_object('status', 'active');
END;
$$;

CREATE OR REPLACE FUNCTION public.world_presence_any_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.world_presence_hosts WHERE state = 'active' AND lease_expires_at > now())
$$;

-- ── Privileges: service_role only (Supabase grants new functions to anon/authenticated by default) ──

REVOKE ALL ON FUNCTION public.world_presence_recovery_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_owner_state(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_location_claim_keyed_v2(uuid, bigint, bigint, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_activate_exclusive(bigint, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_presence_any_active() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.world_presence_recovery_version() TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_owner_state(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed_v2(uuid, bigint, bigint, uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_activate_exclusive(bigint, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_presence_any_active() TO service_role;
