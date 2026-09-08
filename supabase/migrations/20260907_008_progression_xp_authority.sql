-- R12: Make pokemon_xp server-authoritative.
--
-- Problem: authenticated clients can INSERT/UPDATE pokemon_xp directly,
-- meaning a client can set xp = 999999 or pick any level without going
-- through game logic. This violates INVARIANTS.md §Progression.
--
-- Fix:
--   1. Revoke INSERT/UPDATE on pokemon_xp from authenticated.
--      SELECT remains (clients need to read their own XP).
--   2. Add grant_pokemon_xp() SECURITY DEFINER — the only way to credit XP.
--      Called by dungeon-reward (R15) and any future XP source.
--   3. Ensure the `level` column exists and stays server-owned.
--      spend_tokens_learn_move (migration 005) already writes pokemon_xp via
--      SECURITY DEFINER, so move updates are unaffected.
--
-- After this migration, any direct client call:
--   supabase.from('pokemon_xp').insert({ xp: 9999 })
--   supabase.from('pokemon_xp').update({ xp: x })
-- will fail with a permission error.

-- ── 1. Column: add `level` if missing, default 1 ─────────────────────────────

ALTER TABLE pokemon_xp
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_updated_at timestamptz;

-- ── 2. Revoke direct client writes ───────────────────────────────────────────

REVOKE INSERT, UPDATE ON TABLE pokemon_xp FROM authenticated;

-- ── 3. grant_pokemon_xp(pokemon_id, xp_amount, reason) ───────────────────────
-- Awards `p_xp_amount` XP to the calling user's pokemon.
-- Uses the Medium Fast XP curve: XP needed to go from level L to L+1 = L³.
-- Validates ownership (caller must own the slot).
-- Returns: { new_xp, new_level, leveled_up }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION grant_pokemon_xp(
  p_pokemon_id integer,
  p_xp_amount  integer,
  p_reason     text DEFAULT 'dungeon'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_old_level  integer;
  v_new_xp     integer;
  v_new_level  integer;
  v_remaining  integer;
BEGIN
  IF p_xp_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_xp_amount';
  END IF;

  -- Caller must own the pokemon
  IF NOT EXISTS (
    SELECT 1 FROM slots
    WHERE pokemon_id = p_pokemon_id AND owner_id = v_caller
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Upsert: create row if missing (xp=0, level=1), then atomically add XP
  INSERT INTO pokemon_xp (user_id, pokemon_id, xp, level, last_updated_at)
  VALUES (v_caller, p_pokemon_id, p_xp_amount, 1, now())
  ON CONFLICT (user_id, pokemon_id) DO UPDATE
    SET xp             = pokemon_xp.xp + EXCLUDED.xp,
        last_updated_at = now()
  RETURNING xp, level
  INTO v_new_xp, v_old_level;

  -- Compute new level using Medium Fast curve: L³ XP to go from level L → L+1
  v_new_level  := v_old_level;
  v_remaining  := v_new_xp;

  -- Walk back from the beginning to find the level for total accumulated XP.
  -- Recompute from scratch so the level column stays consistent even if it
  -- drifted in the legacy client-side path.
  v_new_level := 1;
  v_remaining := v_new_xp;
  WHILE v_new_level < 100 AND v_remaining >= POWER(v_new_level, 3)::integer LOOP
    v_remaining := v_remaining - POWER(v_new_level, 3)::integer;
    v_new_level := v_new_level + 1;
  END LOOP;

  -- Persist the computed level
  UPDATE pokemon_xp
  SET level = v_new_level
  WHERE user_id = v_caller AND pokemon_id = p_pokemon_id;

  RETURN jsonb_build_object(
    'new_xp',     v_new_xp,
    'new_level',  v_new_level,
    'leveled_up', v_new_level > v_old_level
  );
END;
$$;

GRANT EXECUTE ON FUNCTION grant_pokemon_xp(integer, integer, text) TO authenticated;
