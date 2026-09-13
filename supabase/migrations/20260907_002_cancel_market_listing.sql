-- MKT-2: cancel_market_listing
-- Atomically deletes the market_listings row and sets slots.is_locked = false
-- in a single transaction. Replaces the client DELETE (Gap V-05) which never
-- unlocked the slot, leaving Pokémon permanently locked on cancellation.

CREATE OR REPLACE FUNCTION cancel_market_listing(
  p_listing_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_listing record;
BEGIN
  SELECT * INTO v_listing
  FROM market_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found';
  END IF;

  IF v_listing.seller_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'not_seller';
  END IF;

  IF v_listing.is_purchased THEN
    RAISE EXCEPTION 'already_purchased';
  END IF;

  DELETE FROM market_listings WHERE id = p_listing_id;

  -- Always unlock even if the slot row is in an unexpected state
  UPDATE slots SET is_locked = false WHERE pokemon_id = v_listing.pokemon_id;

  RETURN jsonb_build_object('pokemon_id', v_listing.pokemon_id);
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_market_listing(uuid) TO authenticated;
