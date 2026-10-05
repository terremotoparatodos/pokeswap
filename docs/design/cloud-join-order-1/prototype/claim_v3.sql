-- CLOUD JOIN-ORDER-1 — PROTOTYPE ONLY (never a migration). Applied on top of the migrations of
-- 5ca9ccd (20261001220000, 20261003120000, 20261005120000) in isolated databases (PGlite tests and the
-- dedicated real-Postgres database of prototype/pg/run.mjs).
--
-- The row records WHICH page and WHICH attempt of that page owns it, bound to the owner session that
-- wrote them: (owner_page, owner_attempt) are valid only while owner_page_session = owner_session, so a
-- v1/keyed/v2 claim (which never writes them) invalidates them by changing owner_session.
--
-- world_location_claim_keyed_v3 = claim v2 (CLOUD READINESS-3) with ONE rule placed BEFORE the key order:
--   same page (valid page info, same page id):
--     attempt <  owner attempt → 'stale_attempt'      (final; nothing written) — whatever the keys
--     attempt =  owner attempt → 'duplicate_attempt'  (final) — unless it is the same key: adoption
--     attempt >  owner attempt → takes the row (the page moved on), except while the owner drains:
--                                'owner_draining' (its final flush is kept)
--   another page, or no valid page info → exactly claim v2.
-- `-- @hook <name>` lines are barrier points for the real-Postgres battery (injected in memory).

ALTER TABLE public.world_player_locations
  ADD COLUMN IF NOT EXISTS owner_page         text   NULL CHECK (owner_page ~ '^[A-Za-z0-9_-]{8,64}$'),
  ADD COLUMN IF NOT EXISTS owner_attempt      bigint NULL CHECK (owner_attempt BETWEEN 1 AND 2147483647),
  ADD COLUMN IF NOT EXISTS owner_page_session uuid   NULL;

CREATE OR REPLACE FUNCTION public.world_location_claim_keyed_v3(
  p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid, p_takeover boolean,
  p_page text, p_attempt bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  h          public.world_presence_hosts;
  v_row      public.world_player_locations;
  v_took     boolean := false;
  v_newer    boolean;
  v_state    text;
  v_answer   text := NULL;
  v_same     boolean;
BEGIN
  IF p_user_id IS NULL OR p_session IS NULL OR p_host_id IS NULL OR p_generation IS NULL OR p_generation < 1
     OR p_seq IS NULL OR p_seq < 1 OR p_takeover IS NULL THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  -- Page and attempt travel together, well formed, or not at all (a client without them: claim v2 rules).
  IF (p_page IS NULL) <> (p_attempt IS NULL)
     OR (p_page IS NOT NULL AND (p_page !~ '^[A-Za-z0-9_-]{8,64}$' OR p_attempt NOT BETWEEN 1 AND 2147483647)) THEN
    RAISE EXCEPTION 'invalid_attempt';
  END IF;
  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;
  IF h.state <> 'active' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;
  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;
  -- @hook after_host

  BEGIN
    INSERT INTO public.world_player_locations (user_id, owner_generation, owner_seq, owner_session, owner_page, owner_attempt, owner_page_session)
    VALUES (p_user_id, p_generation, p_seq, p_session, p_page, p_attempt, CASE WHEN p_page IS NULL THEN NULL ELSE p_session END)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING * INTO v_row;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('status', 'unknown_user');
  END;
  v_took := FOUND;

  IF NOT v_took THEN
    SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id FOR UPDATE;
    -- @hook after_row
    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF;
      -- adoption: a lost answer retried (same key, same session)
    ELSE
      v_same := p_page IS NOT NULL AND v_row.owner_page_session IS NOT DISTINCT FROM v_row.owner_session /*PROTO:page-session*/
                AND v_row.owner_page = p_page;
      IF v_same THEN /*PROTO:same-page*/
        IF p_attempt < v_row.owner_attempt THEN v_answer := 'stale_attempt';
        ELSIF p_attempt = v_row.owner_attempt THEN v_answer := 'duplicate_attempt'; /*PROTO:duplicate*/
        ELSIF public.world_presence_owner_state(v_row.owner_generation) = 'draining' THEN v_answer := 'owner_draining';
        ELSE v_answer := NULL;                                            -- the page moved on: take
        END IF;
      ELSIF (v_row.owner_generation, v_row.owner_seq) < (p_generation, p_seq) THEN
        v_answer := NULL;                                                 -- claim v1/v2: a greater key takes
      ELSE
        v_state := public.world_presence_owner_state(v_row.owner_generation);
        -- @hook after_state
        IF v_state = 'draining' THEN v_answer := 'owner_draining';
        ELSIF v_state IN ('stopped', 'unknown') THEN v_answer := NULL;
        ELSIF v_state = 'unreachable' THEN v_answer := CASE WHEN p_takeover THEN NULL ELSE 'owner_unreachable' END;
        ELSE v_answer := 'superseded';
        END IF;
      END IF;
      IF v_answer IS NOT NULL THEN
        v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
        RETURN jsonb_build_object('status', v_answer, 'newerActive', v_newer);
      END IF;
      UPDATE public.world_player_locations
         SET epoch = epoch + 1, seq = 0, updated_at = now(),
             owner_generation = p_generation, owner_seq = p_seq, owner_session = p_session,
             owner_page = p_page, owner_attempt = p_attempt, owner_page_session = CASE WHEN p_page IS NULL THEN NULL ELSE p_session END
       WHERE user_id = p_user_id
      RETURNING * INTO v_row;
    END IF;
  END IF;

  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts x WHERE x.generation > p_generation AND x.state = 'active' AND x.lease_expires_at > now());
  RETURN jsonb_build_object('status', 'claimed', 'epoch', v_row.epoch, 'newerActive', v_newer,
    'location', CASE WHEN v_row.area_id IS NULL THEN NULL ELSE jsonb_build_object(
      'areaId', v_row.area_id, 'tx', v_row.tx, 'ty', v_row.ty, 'layoutVersion', v_row.layout_version) END);
END;
$$;

REVOKE ALL ON FUNCTION public.world_location_claim_keyed_v3(uuid, bigint, bigint, uuid, uuid, boolean, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed_v3(uuid, bigint, bigint, uuid, uuid, boolean, text, bigint) TO service_role;
