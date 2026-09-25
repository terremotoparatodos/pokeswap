-- INTEGRATION-1 — WORLD × SKILLS server authority (PREPARED, NOT APPLIED TO PRODUCTION)
--
-- What this adds, and why each piece exists:
--
--   player_skill_xp          one row per (player, skill); the level is derived from XP by
--                            SKILLS and never stored next to it.
--   player_materials         one row per (player, material); quantities only go up here
--                            (no sink exists yet).
--   skill_work_settlements   one row per settled work action: the action_id primary key is
--                            what makes a settlement happen exactly once, in the database,
--                            whatever the realtime process retries.
--   world_node_overrides     the sparse mutable state of WORLD resource nodes and plots.
--                            A node in its base state has no row: the layout is derived
--                            from the world seed and never stored.
--
--   world_commit_work(...)   ONE transaction: settlement row (unique) + XP + materials +
--                            the node's new physical state. Either everything happens or
--                            nothing does; a second call with the same action_id changes
--                            nothing and returns the first result.
--   world_player_state(...)  what a player's session needs: XP, materials, workable Pokémon.
--   world_owns_pokemon(...)  ownership of one Pokémon, for a user id the server authenticated.
--   world_load_nodes()       every override still in force, for a realtime restart.
--
-- Trust boundary (AGENTS §2, §3, §10): anon and authenticated can read only their own XP,
-- materials and settlements, and can write nothing here. Every function is executable by
-- service_role only; the only production caller is the `world-authority` Edge Function,
-- which is reachable only with a server-held secret (never shipped to a browser).
-- No existing table or data is altered.

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.player_skill_xp (
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  skill_id   text        NOT NULL CHECK (skill_id IN ('woodcutting', 'mining', 'farming')),
  xp         integer     NOT NULL DEFAULT 0 CHECK (xp >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS public.player_materials (
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  material_id text        NOT NULL CHECK (material_id ~ '^[a-z][a-z0-9_]{1,31}$'),
  quantity    integer     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, material_id)
);

CREATE TABLE IF NOT EXISTS public.skill_work_settlements (
  action_id     text        PRIMARY KEY CHECK (char_length(action_id) BETWEEN 8 AND 64),
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  skill_id      text        NOT NULL CHECK (skill_id IN ('woodcutting', 'mining', 'farming')),
  outcome       text        NOT NULL CHECK (outcome IN ('completed', 'cancelled')),
  xp_gained     integer     NOT NULL CHECK (xp_gained >= 0),
  xp_after      integer     NOT NULL CHECK (xp_after >= 0),
  rewards       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  level_before  smallint    NOT NULL,
  level_after   smallint    NOT NULL,
  node_id       text        NULL,
  rules_version text        NOT NULL,
  settled_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skill_work_settlements_user_idx
  ON public.skill_work_settlements (user_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS public.world_node_overrides (
  node_id    text        PRIMARY KEY CHECK (char_length(node_id) BETWEEN 3 AND 64),
  area_id    text        NOT NULL,
  chunk_id   text        NOT NULL,
  state      text        NOT NULL CHECK (state ~ '^[a-z]{3,16}$'),
  -- When the node's timed state ends (a depleted tree respawns). NULL: no timer.
  respawn_at timestamptz NULL,
  -- Plot data (crop, owner, planted/ready instants, tended). NULL for trees and rocks.
  plot       jsonb       NULL,
  action_id  text        NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_node_overrides_respawn_idx
  ON public.world_node_overrides (respawn_at);

-- ── Row level security and privileges ───────────────────────────────────────

ALTER TABLE public.player_skill_xp        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_materials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_work_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.world_node_overrides   ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges grant everything on new public tables to the
-- client roles. Take all of it back, then give back only reads of one's own rows.
REVOKE ALL ON TABLE public.player_skill_xp        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.player_materials       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.skill_work_settlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.world_node_overrides   FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.player_skill_xp        TO authenticated;
GRANT SELECT ON TABLE public.player_materials       TO authenticated;
GRANT SELECT ON TABLE public.skill_work_settlements TO authenticated;

DROP POLICY IF EXISTS "read own skill xp" ON public.player_skill_xp;
CREATE POLICY "read own skill xp" ON public.player_skill_xp
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "read own materials" ON public.player_materials;
CREATE POLICY "read own materials" ON public.player_materials
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "read own settlements" ON public.skill_work_settlements;
CREATE POLICY "read own settlements" ON public.skill_work_settlements
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- world_node_overrides: no client policy at all. Clients learn node state from the realtime server.

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.player_skill_xp        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.player_materials       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.skill_work_settlements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.world_node_overrides   TO service_role;

-- ── world_commit_work ───────────────────────────────────────────────────────
--
-- p_rewards: [{ "itemId": text, "quantity": int, "bonus": bool }]
-- p_node:    { "nodeId", "areaId", "chunkId", "state", "respawnAt" (epoch ms | null),
--              "plot" (object | null), "base" (bool) } or NULL (no physical change)
--
-- Returns { applied, settlement, xp, materials }:
--   applied = true   the first commit of this action: everything was written;
--   applied = false  the action was already settled: nothing changed, and
--                    `settlement` is the stored one (same XP, same rewards).

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
BEGIN
  IF p_xp_gained IS NULL OR p_xp_gained < 0 OR p_xp_gained > 100000 THEN
    RAISE EXCEPTION 'invalid_xp';
  END IF;
  IF jsonb_typeof(COALESCE(p_rewards, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_rewards, '[]'::jsonb)) > 8 THEN
    RAISE EXCEPTION 'invalid_rewards';
  END IF;

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

  IF p_node IS NOT NULL THEN
    IF COALESCE((p_node ->> 'base')::boolean, false) THEN
      DELETE FROM public.world_node_overrides WHERE node_id = p_node ->> 'nodeId';
    ELSE
      INSERT INTO public.world_node_overrides (node_id, area_id, chunk_id, state, respawn_at, plot, action_id, updated_at)
      VALUES (
        p_node ->> 'nodeId', p_node ->> 'areaId', p_node ->> 'chunkId', p_node ->> 'state',
        CASE WHEN p_node ->> 'respawnAt' IS NULL THEN NULL
             ELSE to_timestamp(((p_node ->> 'respawnAt')::bigint) / 1000.0) END,
        CASE WHEN jsonb_typeof(p_node -> 'plot') = 'object' THEN p_node -> 'plot' ELSE NULL END,
        p_action_id, now()
      )
      ON CONFLICT (node_id) DO UPDATE SET
        area_id = EXCLUDED.area_id, chunk_id = EXCLUDED.chunk_id, state = EXCLUDED.state,
        respawn_at = EXCLUDED.respawn_at, plot = EXCLUDED.plot, action_id = EXCLUDED.action_id, updated_at = now();
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.skill_work_settlements WHERE action_id = p_action_id;
  RETURN jsonb_build_object('applied', true, 'settlement', to_jsonb(v_existing));
END;
$$;

-- ── world_player_state ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.world_player_state(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'xp', COALESCE((SELECT jsonb_object_agg(skill_id, xp) FROM public.player_skill_xp WHERE user_id = p_user_id), '{}'::jsonb),
    'materials', COALESCE((SELECT jsonb_object_agg(material_id, quantity) FROM public.player_materials WHERE user_id = p_user_id AND quantity > 0), '{}'::jsonb),
    'pokemon', COALESCE((
      SELECT jsonb_agg(pokemon_id ORDER BY pokemon_id)
      FROM (SELECT pokemon_id FROM public.slots
            WHERE owner_id = p_user_id AND COALESCE(is_locked, false) = false
            ORDER BY pokemon_id LIMIT 500) owned
    ), '[]'::jsonb)
  );
$$;

-- ── world_owns_pokemon ──────────────────────────────────────────────────────
-- Legacy instance model: a slot's pokemon_id is both the instance and its species.

CREATE OR REPLACE FUNCTION public.world_owns_pokemon(p_user_id uuid, p_pokemon_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.slots
    WHERE owner_id = p_user_id AND pokemon_id = p_pokemon_id AND COALESCE(is_locked, false) = false
  );
$$;

-- ── world_load_nodes ────────────────────────────────────────────────────────
-- Overrides still in force; expired timed ones (respawned trees) are removed on the way.

CREATE OR REPLACE FUNCTION public.world_load_nodes()
RETURNS SETOF public.world_node_overrides
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.world_node_overrides WHERE plot IS NULL AND respawn_at IS NOT NULL AND respawn_at <= now();
  RETURN QUERY SELECT * FROM public.world_node_overrides ORDER BY node_id;
END;
$$;

REVOKE ALL ON FUNCTION public.world_commit_work(text, uuid, text, text, integer, jsonb, smallint, smallint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.world_player_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.world_owns_pokemon(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.world_load_nodes() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.world_commit_work(text, uuid, text, text, integer, jsonb, smallint, smallint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_player_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_owns_pokemon(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.world_load_nodes() TO service_role;
