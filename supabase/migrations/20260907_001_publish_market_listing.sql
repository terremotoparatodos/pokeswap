-- MKT-1: publish_market_listing
-- Atomically inserts a market_listings row and sets slots.is_locked = true
-- in a single transaction. Replaces the two-step client write (Gap V-04).
-- Caller identity comes from auth.uid() — must be called with the user's JWT.

CREATE OR REPLACE FUNCTION publish_market_listing(
  p_pokemon_id   integer,
  p_price_tokens integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_slot       record;
  v_poke_locked boolean;
  v_username   text;
  v_listing_id uuid;
BEGIN
  IF p_price_tokens <= 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  -- Lock the slot row to block concurrent publish/swap/buy
  SELECT owner_id, is_locked INTO v_slot
  FROM slots
  WHERE pokemon_id = p_pokemon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'slot_not_found';
  END IF;

  IF v_slot.owner_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  IF v_slot.is_locked THEN
    RAISE EXCEPTION 'already_locked';
  END IF;

  SELECT locked INTO v_poke_locked FROM pokemon WHERE id = p_pokemon_id;
  IF v_poke_locked THEN
    RAISE EXCEPTION 'pokemon_admin_locked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM market_listings
    WHERE pokemon_id = p_pokemon_id
      AND is_purchased = false
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'active_listing_exists';
  END IF;

  SELECT username INTO v_username FROM profiles WHERE id = v_caller;

  INSERT INTO market_listings (pokemon_id, seller_id, seller_username, price_tokens)
  VALUES (p_pokemon_id, v_caller, v_username, p_price_tokens)
  RETURNING id INTO v_listing_id;

  UPDATE slots SET is_locked = true WHERE pokemon_id = p_pokemon_id;

  RETURN jsonb_build_object('listing_id', v_listing_id);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_market_listing(integer, integer) TO authenticated;
