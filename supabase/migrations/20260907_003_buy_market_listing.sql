-- MKT-3: buy_market_listing
-- Wraps the full market purchase sequence in a single transaction.
-- Replaces the sequential inline writes in market-buy Edge Function (INV-MKT-3).
-- Fixes: non-atomic debit/credit, activity_feed target_username bug (was UUID).

CREATE OR REPLACE FUNCTION buy_market_listing(
  p_listing_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_caller          uuid := auth.uid();
  v_listing         record;
  v_slot            record;
  v_buyer_username  text;
  v_fee             integer;
  v_seller_receives integer;
  v_transaction_id  uuid;
  v_now             timestamptz := now();
BEGIN
  -- Lock the listing row — this is the primary anti-double-buy guard
  SELECT * INTO v_listing
  FROM market_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found';
  END IF;

  IF v_listing.is_purchased THEN
    RAISE EXCEPTION 'already_purchased';
  END IF;

  IF v_listing.expires_at <= v_now THEN
    RAISE EXCEPTION 'listing_expired';
  END IF;

  IF v_listing.seller_id = v_caller THEN
    RAISE EXCEPTION 'cannot_buy_own_listing';
  END IF;

  -- Atomic debit: fails without raising if balance is insufficient
  UPDATE profiles
  SET tokens = tokens - v_listing.price_tokens
  WHERE id = v_caller
    AND tokens >= v_listing.price_tokens
  RETURNING username INTO v_buyer_username;

  IF v_buyer_username IS NULL THEN
    -- Either profile not found or insufficient tokens
    RAISE EXCEPTION 'insufficient_tokens';
  END IF;

  -- Compute fee (5%) and seller proceeds
  v_fee := floor(v_listing.price_tokens * 0.05);
  v_seller_receives := v_listing.price_tokens - v_fee;

  -- Mark listing purchased
  UPDATE market_listings
  SET is_purchased = true,
      purchased_by = v_caller,
      purchased_at = v_now
  WHERE id = p_listing_id;

  -- Get current slot state for preservation of aura/first_owner data
  SELECT aura, first_owner_id, first_owner_username, claim_count
  INTO v_slot
  FROM slots
  WHERE pokemon_id = v_listing.pokemon_id;

  -- Transfer slot to buyer and unlock
  INSERT INTO slots (
    pokemon_id, owner_id, owner_username, is_locked,
    aura, aura_updated_at, owned_since, claim_count,
    first_owner_id, first_owner_username, updated_at
  ) VALUES (
    v_listing.pokemon_id, v_caller, v_buyer_username, false,
    COALESCE(v_slot.aura, 0), v_now, v_now,
    COALESCE(v_slot.claim_count, 0) + 1,
    COALESCE(v_slot.first_owner_id, v_caller),
    COALESCE(v_slot.first_owner_username, v_buyer_username),
    v_now
  )
  ON CONFLICT (pokemon_id) DO UPDATE SET
    owner_id              = EXCLUDED.owner_id,
    owner_username        = EXCLUDED.owner_username,
    is_locked             = false,
    aura                  = EXCLUDED.aura,
    aura_updated_at       = EXCLUDED.aura_updated_at,
    owned_since           = EXCLUDED.owned_since,
    claim_count           = EXCLUDED.claim_count,
    updated_at            = EXCLUDED.updated_at;

  -- Credit seller (atomic increment — no balance read needed)
  UPDATE profiles
  SET tokens = tokens + v_seller_receives
  WHERE id = v_listing.seller_id;

  -- Permanent transaction record
  INSERT INTO transactions (
    pokemon_id, buyer_id, buyer_username,
    seller_id, seller_username, price,
    payment_provider, payment_status
  ) VALUES (
    v_listing.pokemon_id, v_caller, v_buyer_username,
    v_listing.seller_id, v_listing.seller_username, v_listing.price_tokens,
    'tokens', 'confirmed'
  )
  RETURNING id INTO v_transaction_id;

  -- Token ledger (linked to transaction)
  INSERT INTO token_ledger (user_id, amount, reason, related_transaction_id, pokemon_id)
  VALUES
    (v_caller,              -v_listing.price_tokens, 'market_purchase', v_transaction_id, v_listing.pokemon_id),
    (v_listing.seller_id,   v_seller_receives,       'market_sale',     v_transaction_id, v_listing.pokemon_id);

  -- Activity feed (fix: seller_username, not seller_id)
  INSERT INTO activity_feed (type, pokemon_id, actor_username, target_username, price)
  VALUES ('claim', v_listing.pokemon_id, v_buyer_username, v_listing.seller_username, v_listing.price_tokens);

  RETURN jsonb_build_object(
    'pokemon_id',      v_listing.pokemon_id,
    'price_paid',      v_listing.price_tokens,
    'fee',             v_fee,
    'seller_received', v_seller_receives
  );
END;
$$;

GRANT EXECUTE ON FUNCTION buy_market_listing(uuid) TO authenticated;
