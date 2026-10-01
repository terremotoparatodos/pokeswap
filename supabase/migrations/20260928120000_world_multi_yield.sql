-- RESOURCE YIELD-2: resources that give several units before they deplete.
--
-- Additive. A tree or rock node now has a hidden stock (2–4, 2–3, 1–3 or 1
-- units, a SKILLS rule; WORLD draws it). Every unit is its own settlement
-- (`settlementId` = `<actionId>-<hex2 index>`, stored in the existing
-- `action_id` column) and carries the node's next stock in `p_node`.
--
-- world_node_overrides rows, after this migration:
--   no row                                  full node / never worked
--   state 'available' + stock_remaining k   partial node, k units left (1–3)
--   state 'depleted'  + stock_remaining NULL  depleted, respawns at respawn_at
--   plot rows                               unchanged
--   respawn_at   partial: 90 s after its last settled unit (then it refills);
--                depleted: the normal respawn
--   action_id    the node's GENERATION TOKEN: the last settlementId applied.
--
-- Existing rows stay valid (stock_remaining NULL). world_load_nodes already
-- drops expired non-plot rows, which is exactly "a partial past its refill
-- instant is full again".
--
-- Rollback: the previous world_commit_work (20260926002154) still works on
-- this table: it never writes stock_remaining, and the previous realtime
-- reads an 'available' row as the base state (full). The column may stay.

ALTER TABLE public.world_node_overrides
  ADD COLUMN IF NOT EXISTS stock_remaining smallint NULL;

ALTER TABLE public.world_node_overrides
  DROP CONSTRAINT IF EXISTS world_node_overrides_stock_remaining_check;
ALTER TABLE public.world_node_overrides
  ADD CONSTRAINT world_node_overrides_stock_remaining_check CHECK (stock_remaining BETWEEN 1 AND 3);

-- ── world_commit_work (same signature) ──────────────────────────────────────
--
-- p_node, as before: { nodeId, areaId, chunkId, state, respawnAt (epoch ms | null),
--                      plot (object | null), base (bool) } or NULL.
-- p_node, a gathered unit (YIELD-2) adds:
--   stock:         { before: 1..4, after: before - 1 }
--   expectedToken: the node's token when WORLD reserved it (NULL = new generation)
--   reservedAt:    epoch ms, WORLD's clock, when the node was reserved
--   state:         'available' when after > 0, 'depleted' when after = 0
--   respawnAt:     epoch ms, same clock: end of the unit + 90 s
--
-- In ONE transaction:
--   1. per-node advisory lock (taken even when the node has no row yet);
--   2. dedupe first: a settlement with this action_id already stored is
--      returned as is (applied = false) and nothing is touched;
--   3. read the node's row;
--   4. CAS, new generation (expectedToken NULL): only if there is no row, or
--      a non-plot row whose respawn_at <= reservedAt (expired at the reservation);
--   5. CAS, partial node (expectedToken T): only if action_id = T, state =
--      'available', stock_remaining = stock.before and respawn_at > reservedAt.
--      Never compared with now(): the reservation instant decides;
--   6. any mismatch: { applied: false, rejected: 'stale_node' } — no RAISE, no
--      settlement, no pay, no node change;
--   7. otherwise settlement + XP + materials + node (stock_remaining =
--      NULLIF(after, 0), action_id = the settlement id).
--
-- Returns { applied, settlement } or { applied: false, rejected: 'stale_node' }.

CREATE OR REPLACE FUNCTION public.world_commit_work(
  p_action_id     text,
  p_user_id       uuid,
  p_skill_id      text,
  p_outcome       text,
  p_xp_gained     integer,
  p_rewards       jsonb,
  p_level_before  smallint,
  p_level_after   smallint,
  p_rules_version text,
  p_node          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inserted  integer;
  v_xp_after  integer;
  v_reward    jsonb;
  v_quantity  integer;
  v_existing  public.skill_work_settlements;
  v_row       public.world_node_overrides;
  v_found     boolean;
  v_stocked   boolean := p_node IS NOT NULL AND p_node ? 'stock';
  v_before    integer;
  v_after     integer;
  v_token     text;
  v_reserved  timestamptz;
  v_respawn   timestamptz;
  v_state     text;
  v_accept    boolean;
BEGIN
  IF p_xp_gained IS NULL OR p_xp_gained < 0 OR p_xp_gained > 100000 THEN
    RAISE EXCEPTION 'invalid_xp';
  END IF;
  IF jsonb_typeof(COALESCE(p_rewards, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_rewards, '[]'::jsonb)) > 8 THEN
    RAISE EXCEPTION 'invalid_rewards';
  END IF;

  -- A malformed stock contract is a bug in the caller, not a stale node.
  IF v_stocked THEN
    IF jsonb_typeof(p_node -> 'stock') <> 'object'
       OR jsonb_typeof(p_node -> 'stock' -> 'before') <> 'number' OR jsonb_typeof(p_node -> 'stock' -> 'after') <> 'number'
       OR jsonb_typeof(p_node -> 'reservedAt') <> 'number' OR jsonb_typeof(p_node -> 'respawnAt') <> 'number'
       OR (p_node ? 'expectedToken' AND jsonb_typeof(p_node -> 'expectedToken') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION 'invalid_stock';
    END IF;
    v_before   := (p_node -> 'stock' ->> 'before')::integer;
    v_after    := (p_node -> 'stock' ->> 'after')::integer;
    v_token    := p_node ->> 'expectedToken';
    v_reserved := to_timestamp(((p_node ->> 'reservedAt')::bigint) / 1000.0);
    v_respawn  := to_timestamp(((p_node ->> 'respawnAt')::bigint) / 1000.0);
    v_state    := p_node ->> 'state';
    IF v_before NOT BETWEEN 1 AND 4 OR v_after <> v_before - 1 OR v_after NOT BETWEEN 0 AND 3
       OR v_state IS DISTINCT FROM (CASE WHEN v_after = 0 THEN 'depleted' ELSE 'available' END)
       OR (p_node ->> 'nodeId') IS NULL THEN
      RAISE EXCEPTION 'invalid_stock';
    END IF;
  END IF;

  -- 1. One writer per node at a time, row or no row.
  IF p_node IS NOT NULL AND (p_node ->> 'nodeId') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_node ->> 'nodeId'));
  END IF;

  -- 2. Dedupe first: a retry of a settled unit changes nothing, not even the node.
  SELECT * INTO v_existing FROM public.skill_work_settlements WHERE action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('applied', false, 'settlement', to_jsonb(v_existing));
  END IF;

  -- 3–6. Compare-and-set on the node's generation token and stock.
  IF v_stocked THEN
    SELECT * INTO v_row FROM public.world_node_overrides WHERE node_id = p_node ->> 'nodeId';
    v_found := FOUND;
    IF v_token IS NULL THEN
      v_accept := NOT v_found
        OR (v_row.plot IS NULL AND v_row.respawn_at IS NOT NULL AND v_row.respawn_at <= v_reserved);
    ELSE
      v_accept := v_found
        AND v_row.action_id IS NOT DISTINCT FROM v_token
        AND v_row.state = 'available'
        AND v_row.stock_remaining IS NOT DISTINCT FROM v_before
        AND v_row.respawn_at IS NOT NULL AND v_row.respawn_at > v_reserved;
    END IF;
    IF NOT v_accept THEN
      RETURN jsonb_build_object('applied', false, 'rejected', 'stale_node');
    END IF;
  END IF;

  -- 7. Settlement, XP, materials and node, together.
  INSERT INTO public.skill_work_settlements
    (action_id, user_id, skill_id, outcome, xp_gained, xp_after, rewards, level_before, level_after, node_id, rules_version)
  VALUES
    (p_action_id, p_user_id, p_skill_id, p_outcome, p_xp_gained, 0, COALESCE(p_rewards, '[]'::jsonb),
     p_level_before, p_level_after, p_node ->> 'nodeId', p_rules_version)
  ON CONFLICT (action_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT * INTO v_existing FROM public.skill_work_settlements WHERE action_id = p_action_id;
    RETURN jsonb_build_object('applied', false, 'settlement', to_jsonb(v_existing));
  END IF;

  INSERT INTO public.player_skill_xp (user_id, skill_id, xp)
  VALUES (p_user_id, p_skill_id, p_xp_gained)
  ON CONFLICT (user_id, skill_id)
  DO UPDATE SET xp = public.player_skill_xp.xp + EXCLUDED.xp, updated_at = now()
  RETURNING xp INTO v_xp_after;

  UPDATE public.skill_work_settlements SET xp_after = v_xp_after WHERE action_id = p_action_id;

  FOR v_reward IN SELECT * FROM jsonb_array_elements(COALESCE(p_rewards, '[]'::jsonb)) LOOP
    v_quantity := (v_reward ->> 'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 100 OR (v_reward ->> 'itemId') IS NULL THEN
      RAISE EXCEPTION 'invalid_reward';
    END IF;
    INSERT INTO public.player_materials (user_id, material_id, quantity)
    VALUES (p_user_id, v_reward ->> 'itemId', v_quantity)
    ON CONFLICT (user_id, material_id)
    DO UPDATE SET quantity = public.player_materials.quantity + EXCLUDED.quantity, updated_at = now();
  END LOOP;

  IF v_stocked THEN
    INSERT INTO public.world_node_overrides (node_id, area_id, chunk_id, state, respawn_at, plot, action_id, stock_remaining, updated_at)
    VALUES (p_node ->> 'nodeId', p_node ->> 'areaId', p_node ->> 'chunkId', v_state, v_respawn, NULL, p_action_id, NULLIF(v_after, 0), now())
    ON CONFLICT (node_id) DO UPDATE SET
      area_id = EXCLUDED.area_id, chunk_id = EXCLUDED.chunk_id, state = EXCLUDED.state, respawn_at = EXCLUDED.respawn_at,
      plot = NULL, action_id = EXCLUDED.action_id, stock_remaining = EXCLUDED.stock_remaining, updated_at = now();
  ELSIF p_node IS NOT NULL THEN
    IF COALESCE((p_node ->> 'base')::boolean, false) THEN
      DELETE FROM public.world_node_overrides WHERE node_id = p_node ->> 'nodeId';
    ELSE
      INSERT INTO public.world_node_overrides (node_id, area_id, chunk_id, state, respawn_at, plot, action_id, stock_remaining, updated_at)
      VALUES (
        p_node ->> 'nodeId', p_node ->> 'areaId', p_node ->> 'chunkId', p_node ->> 'state',
        CASE WHEN p_node ->> 'respawnAt' IS NULL THEN NULL
             ELSE to_timestamp(((p_node ->> 'respawnAt')::bigint) / 1000.0) END,
        CASE WHEN jsonb_typeof(p_node -> 'plot') = 'object' THEN p_node -> 'plot' ELSE NULL END,
        p_action_id, NULL, now()
      )
      ON CONFLICT (node_id) DO UPDATE SET
        area_id = EXCLUDED.area_id, chunk_id = EXCLUDED.chunk_id, state = EXCLUDED.state,
        respawn_at = EXCLUDED.respawn_at, plot = EXCLUDED.plot, action_id = EXCLUDED.action_id,
        stock_remaining = NULL, updated_at = now();
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.skill_work_settlements WHERE action_id = p_action_id;
  RETURN jsonb_build_object('applied', true, 'settlement', to_jsonb(v_existing));
END;
$$;

REVOKE ALL ON FUNCTION public.world_commit_work(text, uuid, text, text, integer, jsonb, smallint, smallint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.world_commit_work(text, uuid, text, text, integer, jsonb, smallint, smallint, text, jsonb) TO service_role;
