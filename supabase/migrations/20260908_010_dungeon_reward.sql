-- DGN-1: award_dungeon_reward RPC (R14)
-- Closes V-02 (dungeon token awards client-written) and V-03 (XP client-written).
-- Dungeon combat runs client-side (INV-DGN-1); this function is the server gate
-- that validates ownership and applies the results atomically.
--
-- Token daily cap (INV-DGN-3): 3,000 tokens per calendar day per user.
-- dungeon_tokens_today resets when dungeon_tokens_reset_at::date < now()::date.
-- XP is delegated to grant_pokemon_xp() (R12) which owns the level curve.
--
-- Input caps applied server-side (client values are advisory, not trusted):
--   p_xp_amount     clamped to [0, 10000]
--   p_tokens_amount clamped to [0, 3000], then further capped by daily remainder

CREATE OR REPLACE FUNCTION award_dungeon_reward(
  p_pokemon_id    integer,
  p_xp_amount     integer,
  p_tokens_amount integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller         uuid    := auth.uid();
  v_profile        record;
  v_now            timestamptz := now();
  v_tokens_today   integer;
  v_daily_cap      constant integer := 3000;
  v_awarded_tokens integer;
  v_new_balance    integer;
  v_xp_result      jsonb;
  v_new_xp         integer := 0;
  v_new_level      integer := 1;
  v_leveled_up     boolean := false;
BEGIN
  -- Verify ownership (also caught inside grant_pokemon_xp, but check early)
  IF NOT EXISTS (
    SELECT 1 FROM slots
    WHERE pokemon_id = p_pokemon_id AND owner_id = v_caller
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Clamp client-supplied values
  p_xp_amount     := GREATEST(0, LEAST(p_xp_amount, 10000));
  p_tokens_amount := GREATEST(0, LEAST(p_tokens_amount, 3000));

  -- Lock profile row for atomic token + counter update
  SELECT tokens, dungeon_tokens_today, dungeon_tokens_reset_at
  INTO v_profile
  FROM profiles
  WHERE id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- Reset daily counter if calendar day has changed
  IF v_profile.dungeon_tokens_reset_at IS NULL
     OR v_profile.dungeon_tokens_reset_at::date < v_now::date
  THEN
    v_tokens_today := 0;
  ELSE
    v_tokens_today := COALESCE(v_profile.dungeon_tokens_today, 0);
  END IF;

  -- Cap at remaining daily allowance
  v_awarded_tokens := LEAST(p_tokens_amount, v_daily_cap - v_tokens_today);
  v_awarded_tokens := GREATEST(v_awarded_tokens, 0);

  UPDATE profiles
  SET tokens                  = COALESCE(tokens, 0) + v_awarded_tokens,
      dungeon_tokens_today    = v_tokens_today + v_awarded_tokens,
      dungeon_tokens_reset_at = v_now
  WHERE id = v_caller
  RETURNING tokens INTO v_new_balance;

  IF v_awarded_tokens > 0 THEN
    INSERT INTO token_ledger (user_id, amount, reason, pokemon_id)
    VALUES (v_caller, v_awarded_tokens, 'dungeon_reward', p_pokemon_id);
  END IF;

  -- Award XP (only when caller earned some)
  IF p_xp_amount > 0 THEN
    v_xp_result  := grant_pokemon_xp(p_pokemon_id, p_xp_amount, 'dungeon');
    v_new_xp     := (v_xp_result->>'new_xp')::integer;
    v_new_level  := (v_xp_result->>'new_level')::integer;
    v_leveled_up := (v_xp_result->>'leveled_up')::boolean;
  ELSE
    SELECT COALESCE(xp, 0), COALESCE(level, 1)
    INTO v_new_xp, v_new_level
    FROM pokemon_xp
    WHERE user_id = v_caller AND pokemon_id = p_pokemon_id;
  END IF;

  RETURN jsonb_build_object(
    'new_xp',         COALESCE(v_new_xp, 0),
    'new_level',      COALESCE(v_new_level, 1),
    'leveled_up',     COALESCE(v_leveled_up, false),
    'tokens_awarded', v_awarded_tokens,
    'new_balance',    COALESCE(v_new_balance, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION award_dungeon_reward(integer, integer, integer) TO authenticated;
