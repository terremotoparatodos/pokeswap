-- TKN-1: Token economy server-side RPCs (R10)
-- Moves passive token collection, move learning, and cooldown skip
-- out of the client and into atomic SECURITY DEFINER functions.
-- All three debit/credit profiles.tokens and write to token_ledger.

-- ──────────────────────────────────────────────────────────────
-- collect_passive_tokens()
-- Credits the caller with tokens earned since the last collection.
-- Formula: sum over owned slots of max(5, round(5 + min(aura,200) + base_aura) / 50)
--   × hours_elapsed (capped at 24h) × token_multiplier.
-- Minimum gap between calls: 3 minutes.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION collect_passive_tokens()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller        uuid := auth.uid();
  v_profile       record;
  v_now           timestamptz := now();
  v_last_collect  timestamptz;
  v_hours         numeric;
  v_total_tph     integer := 0;
  v_tph           integer;
  v_aura          numeric;
  v_earned        integer;
  v_new_balance   integer;
  v_rec           record;
BEGIN
  SELECT tokens, token_multiplier, passive_tokens_collected_at
  INTO v_profile
  FROM profiles
  WHERE id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  v_last_collect := COALESCE(v_profile.passive_tokens_collected_at, v_now);
  v_hours := LEAST(
    EXTRACT(EPOCH FROM (v_now - v_last_collect)) / 3600.0,
    24.0
  );

  -- Minimum 3-minute gap (0.05 hours)
  IF v_hours < 0.05 THEN
    RAISE EXCEPTION 'too_soon';
  END IF;

  -- Sum TPH across all slots owned by caller
  FOR v_rec IN
    SELECT sl.aura, p.base_aura
    FROM slots sl
    JOIN pokemon p ON p.id = sl.pokemon_id
    WHERE sl.owner_id = v_caller
  LOOP
    v_aura := LEAST(COALESCE(v_rec.aura, 0), 200) + COALESCE(v_rec.base_aura, 0);
    v_tph  := GREATEST(5, ROUND(5 + v_aura / 50.0)::integer);
    v_total_tph := v_total_tph + v_tph;
  END LOOP;

  IF v_total_tph = 0 THEN
    RAISE EXCEPTION 'no_pokemon_owned';
  END IF;

  v_earned := FLOOR(v_total_tph * v_hours * COALESCE(v_profile.token_multiplier, 1));

  IF v_earned <= 0 THEN
    RAISE EXCEPTION 'no_tokens_earned';
  END IF;

  UPDATE profiles
  SET tokens = COALESCE(tokens, 0) + v_earned,
      passive_tokens_collected_at = v_now
  WHERE id = v_caller
  RETURNING tokens INTO v_new_balance;

  INSERT INTO token_ledger (user_id, amount, reason)
  VALUES (v_caller, v_earned, 'passive_income');

  RETURN jsonb_build_object(
    'delta',       v_earned,
    'new_balance', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION collect_passive_tokens() TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- spend_tokens_learn_move(pokemon_id, new_move_slug, replace_idx, new_moves)
-- Debits 150 tokens and updates pokemon_xp.moves atomically.
-- Cost is charged whether the user confirms or cancels the move choice
-- (matches legacy behavior: cancel still costs 150).
-- new_moves: the full updated move-slug array as JSONB.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION spend_tokens_learn_move(
  p_pokemon_id integer,
  p_new_moves  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_new_balance integer;
  v_cost       constant integer := 150;
BEGIN
  -- Verify caller owns the pokemon
  IF NOT EXISTS (
    SELECT 1 FROM slots
    WHERE pokemon_id = p_pokemon_id AND owner_id = v_caller
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Atomic debit — fails if insufficient balance
  UPDATE profiles
  SET tokens = tokens - v_cost
  WHERE id = v_caller
    AND COALESCE(tokens, 0) >= v_cost
  RETURNING tokens INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'insufficient_tokens';
  END IF;

  -- Update moves (upsert — pokemon_xp row may not exist yet)
  INSERT INTO pokemon_xp (user_id, pokemon_id, xp, moves)
  VALUES (v_caller, p_pokemon_id, 0, p_new_moves)
  ON CONFLICT (user_id, pokemon_id) DO UPDATE
    SET moves = EXCLUDED.moves;

  INSERT INTO token_ledger (user_id, amount, reason, pokemon_id)
  VALUES (v_caller, -v_cost, 'learn_move', p_pokemon_id);

  RETURN jsonb_build_object('new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION spend_tokens_learn_move(integer, jsonb) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- skip_swap_cooldown()
-- Debits 1,000 tokens and clears swap_cooldown_until.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION skip_swap_cooldown()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_new_balance integer;
  v_cost       constant integer := 1000;
BEGIN
  -- Verify there is an active cooldown worth skipping
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller
      AND swap_cooldown_until > now()
  ) THEN
    RAISE EXCEPTION 'no_active_cooldown';
  END IF;

  -- Atomic debit
  UPDATE profiles
  SET tokens = tokens - v_cost,
      swap_cooldown_until = NULL
  WHERE id = v_caller
    AND COALESCE(tokens, 0) >= v_cost
    AND swap_cooldown_until > now()
  RETURNING tokens INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    -- Could be insufficient tokens or cooldown expired between checks
    RAISE EXCEPTION 'insufficient_tokens_or_no_cooldown';
  END IF;

  INSERT INTO token_ledger (user_id, amount, reason)
  VALUES (v_caller, -v_cost, 'skip_swap_cooldown');

  RETURN jsonb_build_object('new_balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION skip_swap_cooldown() TO authenticated;
