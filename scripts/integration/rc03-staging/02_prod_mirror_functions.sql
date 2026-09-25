-- RC-0.3 staging: the production functions that write public.slots, with their
-- production ACLs (read from the catalog 2026-09-25). Local staging only.

CREATE OR REPLACE FUNCTION public.publish_market_listing(p_pokemon_id integer, p_price_tokens integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_slot       record;
  v_poke_locked boolean;
  v_username   text;
  v_listing_id uuid;
BEGIN
  IF p_price_tokens <= 0 THEN RAISE EXCEPTION 'invalid_price'; END IF;
  SELECT owner_id, is_locked INTO v_slot FROM slots WHERE pokemon_id = p_pokemon_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'slot_not_found'; END IF;
  IF v_slot.owner_id IS DISTINCT FROM v_caller THEN RAISE EXCEPTION 'not_owner'; END IF;
  IF v_slot.is_locked THEN RAISE EXCEPTION 'already_locked'; END IF;
  SELECT locked INTO v_poke_locked FROM pokemon WHERE id = p_pokemon_id;
  IF v_poke_locked THEN RAISE EXCEPTION 'pokemon_admin_locked'; END IF;
  IF EXISTS (SELECT 1 FROM market_listings WHERE pokemon_id = p_pokemon_id AND is_purchased = false AND expires_at > now()) THEN
    RAISE EXCEPTION 'active_listing_exists';
  END IF;
  SELECT username INTO v_username FROM profiles WHERE id = v_caller;
  INSERT INTO market_listings (pokemon_id, seller_id, seller_username, price_tokens)
  VALUES (p_pokemon_id, v_caller, v_username, p_price_tokens) RETURNING id INTO v_listing_id;
  UPDATE slots SET is_locked = true WHERE pokemon_id = p_pokemon_id;
  RETURN jsonb_build_object('listing_id', v_listing_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_market_listing(p_listing_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller  uuid := auth.uid();
  v_listing record;
BEGIN
  SELECT * INTO v_listing FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;
  IF v_listing.seller_id IS DISTINCT FROM v_caller THEN RAISE EXCEPTION 'not_seller'; END IF;
  IF v_listing.is_purchased THEN RAISE EXCEPTION 'already_purchased'; END IF;
  DELETE FROM market_listings WHERE id = p_listing_id;
  UPDATE slots SET is_locked = false WHERE pokemon_id = v_listing.pokemon_id;
  RETURN jsonb_build_object('pokemon_id', v_listing.pokemon_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.buy_market_listing(p_listing_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  SELECT * INTO v_listing FROM market_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;
  IF v_listing.is_purchased THEN RAISE EXCEPTION 'already_purchased'; END IF;
  IF v_listing.expires_at <= v_now THEN RAISE EXCEPTION 'listing_expired'; END IF;
  IF v_listing.seller_id = v_caller THEN RAISE EXCEPTION 'cannot_buy_own_listing'; END IF;
  UPDATE profiles SET tokens = tokens - v_listing.price_tokens
  WHERE id = v_caller AND tokens >= v_listing.price_tokens RETURNING username INTO v_buyer_username;
  IF v_buyer_username IS NULL THEN RAISE EXCEPTION 'insufficient_tokens'; END IF;
  v_fee := floor(v_listing.price_tokens * 0.05);
  v_seller_receives := v_listing.price_tokens - v_fee;
  UPDATE market_listings SET is_purchased = true, purchased_by = v_caller, purchased_at = v_now WHERE id = p_listing_id;
  SELECT aura, first_owner_id, first_owner_username, claim_count INTO v_slot FROM slots WHERE pokemon_id = v_listing.pokemon_id;
  INSERT INTO slots (pokemon_id, owner_id, owner_username, is_locked, aura, aura_updated_at, owned_since, claim_count, first_owner_id, first_owner_username, updated_at)
  VALUES (v_listing.pokemon_id, v_caller, v_buyer_username, false, COALESCE(v_slot.aura, 0), v_now, v_now, COALESCE(v_slot.claim_count, 0) + 1,
          COALESCE(v_slot.first_owner_id, v_caller), COALESCE(v_slot.first_owner_username, v_buyer_username), v_now)
  ON CONFLICT (pokemon_id) DO UPDATE SET
    owner_id = EXCLUDED.owner_id, owner_username = EXCLUDED.owner_username, is_locked = false, aura = EXCLUDED.aura,
    aura_updated_at = EXCLUDED.aura_updated_at, owned_since = EXCLUDED.owned_since, claim_count = EXCLUDED.claim_count, updated_at = EXCLUDED.updated_at;
  UPDATE profiles SET tokens = tokens + v_seller_receives WHERE id = v_listing.seller_id;
  INSERT INTO transactions (pokemon_id, buyer_id, buyer_username, seller_id, seller_username, price, payment_provider, payment_status)
  VALUES (v_listing.pokemon_id, v_caller, v_buyer_username, v_listing.seller_id, v_listing.seller_username, v_listing.price_tokens, 'tokens', 'confirmed')
  RETURNING id INTO v_transaction_id;
  INSERT INTO token_ledger (user_id, amount, reason, related_transaction_id, pokemon_id) VALUES
    (v_caller, -v_listing.price_tokens, 'market_purchase', v_transaction_id, v_listing.pokemon_id),
    (v_listing.seller_id, v_seller_receives, 'market_sale', v_transaction_id, v_listing.pokemon_id);
  INSERT INTO activity_feed (type, pokemon_id, actor_username, target_username, price)
  VALUES ('claim', v_listing.pokemon_id, v_buyer_username, v_listing.seller_username, v_listing.price_tokens);
  RETURN jsonb_build_object('pokemon_id', v_listing.pokemon_id, 'price_paid', v_listing.price_tokens, 'fee', v_fee, 'seller_received', v_seller_receives);
END;
$function$;

-- claim_slot / confirm_payment: after SEC-1 only service_role executes them.
-- The tests need their signatures and ACLs (a client must be refused before the
-- body runs), so these bodies are stand-ins that WOULD hand a slot over if a
-- client ever reached them — a refusal therefore proves the ACL, not the body.
CREATE OR REPLACE FUNCTION public.claim_slot(p_pokemon_id integer, p_buyer_id uuid, p_payment_provider text, p_payment_id text, p_is_free boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO slots (pokemon_id, owner_id, is_locked) VALUES (p_pokemon_id, p_buyer_id, false)
  ON CONFLICT (pokemon_id) DO UPDATE SET owner_id = p_buyer_id, is_locked = false;
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_payment(p_transaction_id uuid, p_payment_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE slots SET owner_id = (SELECT buyer_id FROM transactions WHERE id = p_transaction_id)
  WHERE pokemon_id = (SELECT pokemon_id FROM transactions WHERE id = p_transaction_id);
  RETURN jsonb_build_object('success', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.publish_market_listing(integer, integer), public.cancel_market_listing(uuid), public.buy_market_listing(uuid) TO PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_slot(integer, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_slot(integer, uuid, text, text, boolean), public.confirm_payment(uuid, text) TO service_role;

-- Placeholder Pokémon (ids 1..493) so slots can reference them.
INSERT INTO public.pokemon (id, name_es, name_en, name_pt, name_fr, type1, region, generation)
SELECT g, 'p' || g, 'p' || g, 'p' || g, 'p' || g, 'normal', 'kanto', 1 FROM generate_series(1, 493) g;
