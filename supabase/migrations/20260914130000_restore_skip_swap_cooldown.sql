-- Restores the production RPC used by the Swap cooldown button.
-- This is deliberately self-contained: production has older dashboard-era
-- migrations, so applying every untracked local migration would be unsafe.

CREATE OR REPLACE FUNCTION skip_swap_cooldown()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_new_balance integer;
  v_cost constant integer := 1000;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = v_caller
      AND swap_cooldown_until > now()
  ) THEN
    RAISE EXCEPTION 'no_active_cooldown';
  END IF;

  UPDATE profiles
  SET tokens = tokens - v_cost,
      swap_cooldown_until = NULL
  WHERE id = v_caller
    AND COALESCE(tokens, 0) >= v_cost
    AND swap_cooldown_until > now()
  RETURNING tokens INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'insufficient_tokens_or_no_cooldown';
  END IF;

  INSERT INTO token_ledger (user_id, amount, reason)
  VALUES (v_caller, -v_cost, 'skip_swap_cooldown');

  RETURN jsonb_build_object('new_balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION skip_swap_cooldown() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION skip_swap_cooldown() FROM anon;
GRANT EXECUTE ON FUNCTION skip_swap_cooldown() TO authenticated;
