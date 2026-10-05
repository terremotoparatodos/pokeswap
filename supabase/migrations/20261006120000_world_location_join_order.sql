-- CLOUD JOIN-ORDER-2 — the order of one page's join attempts across realtime processes
-- (docs/design/CLOUD_JOIN_ORDER_2_REPORT.md; contract: docs/design/CLOUD_JOIN_ORDER_1_PROPOSAL.md).
--
-- Additive: three nullable columns on world_player_locations, and two new functions. No existing
-- function, policy or privilege changes; the v1 (keyed) and v2 (recovery) claims keep their bodies
-- and never write the new columns. Idempotent (localDatabase.js re-runs every migration).
--
--   owner_page, owner_attempt, owner_page_session
--       WHICH page (the client's per-page-load id) and WHICH of its join attempts own the row,
--       bound to the owner session that wrote them: they are valid ONLY while
--       owner_page_session = owner_session. Any claim that does not write them (v1, v2, a v3 take
--       by another session) changes owner_session and so invalidates them, never ambiguously.
--
--   world_location_join_order_version()   1. The capability marker: world-authority answers its
--                                         'capabilities' op from it.
--
--   world_location_claim_keyed_v3(user, generation, seq, session, host, takeover, recovery, page, attempt)
--       The keyed claim with ONE rule added BEFORE the key order, and it only REFUSES:
--         same page (valid page info, same page id) and attempt <= the owner's attempt
--             attempt <  owner attempt → 'stale_attempt'      (final; nothing written)
--             attempt =  owner attempt → 'duplicate_attempt'  (final; nothing written)
--         whatever the keys: an abandoned attempt never takes the row from the page's newer one.
--       Everything else is decided exactly as today, by `p_recovery`:
--         false → the v1 keyed rules (greater key takes, same key adopts, else 'superseded');
--         true  → the v2 rules (owner state; takeover only from an unreachable owner, explicit).
--       A NEWER attempt of the same page gains nothing: the counter orders a page's own joins and
--       authorizes no takeover (it takes only where v1/v2 would take). A take, or the first claim,
--       records the page and attempt with the session. A retry of the SAME claim (same key) adopts
--       first, so it stays idempotent.
--
-- `-- @hook <name>` lines are comments: the Postgres battery (scripts/world-location/join-order-concurrency)
-- injects its barriers there IN MEMORY.
-- Rollback: scripts/world-location/rollback_world_location_join_order.sql (before the recovery rollback).

ALTER TABLE public.world_player_locations
  ADD COLUMN IF NOT EXISTS owner_page         text   NULL CHECK (owner_page ~ '^[A-Za-z0-9_-]{8,64}$'),
  ADD COLUMN IF NOT EXISTS owner_attempt      bigint NULL CHECK (owner_attempt BETWEEN 1 AND 2147483647),
  ADD COLUMN IF NOT EXISTS owner_page_session uuid   NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'world_player_locations_owner_page_shape'
                   AND conrelid = 'public.world_player_locations'::regclass) THEN
    -- The three travel together, or not at all.
    ALTER TABLE public.world_player_locations ADD CONSTRAINT world_player_locations_owner_page_shape
      CHECK ((owner_page IS NULL) = (owner_attempt IS NULL) AND (owner_page IS NULL) = (owner_page_session IS NULL));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.world_location_join_order_version()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$ SELECT 1 $$;

CREATE OR REPLACE FUNCTION public.world_location_claim_keyed_v3(
  p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid,
  p_takeover boolean, p_recovery boolean, p_page text, p_attempt bigint)
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
  v_state  text;
  v_answer text := NULL;
BEGIN
  IF p_user_id IS NULL OR p_session IS NULL OR p_host_id IS NULL OR p_generation IS NULL OR p_generation < 1
     OR p_seq IS NULL OR p_seq < 1 OR p_takeover IS NULL OR p_recovery IS NULL
     OR (p_takeover AND NOT p_recovery) THEN -- a takeover exists only with the recovery rules
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  IF p_page IS NULL OR p_attempt IS NULL OR p_page !~ '^[A-Za-z0-9_-]{8,64}$' OR p_attempt NOT BETWEEN 1 AND 2147483647 THEN
    RAISE EXCEPTION 'invalid_attempt';
  END IF;
  -- The caller's host gate, exactly as v1/v2 (FOR SHARE: a concurrent drain/stop of THIS host waits).
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state <> 'active' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;
  -- @hook after_host

  BEGIN
    INSERT INTO public.world_player_locations (user_id, owner_generation, owner_seq, owner_session, owner_page, owner_attempt, owner_page_session)
    VALUES (p_user_id, p_generation, p_seq, p_session, p_page, p_attempt, p_session)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING * INTO v_row;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('status', 'unknown_user');
  END;
  v_took := FOUND;

  IF NOT v_took THEN
    -- The row exists: lock it, then decide (every claim of this user serializes here).
    SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id FOR UPDATE;
    -- @hook after_row
    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      -- Adoption (a lost answer retried), as v1/v2: nothing written, whatever the page info says.
      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF;
    ELSE
      IF v_row.owner_page_session IS NOT NULL AND v_row.owner_page_session = v_row.owner_session
         AND v_row.owner_page = p_page AND p_attempt <= v_row.owner_attempt THEN
        -- The page already moved past this attempt (or this is a replay of the same one).
        v_answer := CASE WHEN p_attempt < v_row.owner_attempt THEN 'stale_attempt' ELSE 'duplicate_attempt' END;
      ELSIF (v_row.owner_generation, v_row.owner_seq) < (p_generation, p_seq) THEN
        v_answer := NULL;                                      -- v1/v2: a strictly greater key takes
      ELSIF NOT p_recovery THEN
        v_answer := 'superseded';                              -- v1
      ELSE
        -- v2 (20261005120000), unchanged: decided on the owner's state, read without locking its host.
        v_state := public.world_presence_owner_state(v_row.owner_generation);
        -- @hook after_state
        IF v_state = 'draining' THEN v_answer := 'owner_draining';
        ELSIF v_state IN ('stopped', 'unknown') THEN v_answer := NULL;
        ELSIF v_state = 'unreachable' THEN v_answer := CASE WHEN p_takeover THEN NULL ELSE 'owner_unreachable' END;
        ELSE v_answer := 'superseded';
        END IF;
      END IF;
      IF v_answer IS NOT NULL THEN
        v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x
                            WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
        RETURN jsonb_build_object('status', v_answer, 'newerActive', v_newer);
      END IF;
      UPDATE public.world_player_locations
         SET epoch = epoch + 1, seq = 0, updated_at = now(),
             owner_generation = p_generation, owner_seq = p_seq, owner_session = p_session,
             owner_page = p_page, owner_attempt = p_attempt, owner_page_session = p_session
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

-- ── Privileges: service_role only (Supabase grants new functions to anon/authenticated by default) ──

REVOKE ALL ON FUNCTION public.world_location_join_order_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.world_location_claim_keyed_v3(uuid, bigint, bigint, uuid, uuid, boolean, boolean, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.world_location_join_order_version() TO service_role;
GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed_v3(uuid, bigint, bigint, uuid, uuid, boolean, boolean, text, bigint) TO service_role;
