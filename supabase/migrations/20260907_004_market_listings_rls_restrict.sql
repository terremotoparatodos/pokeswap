-- MKT-7: Restrict market_listings RLS
-- Removes the 'sellers manage own listings' ALL policy that allowed direct
-- client INSERT and DELETE. After this migration, all listing mutations
-- must go through the SECURITY DEFINER RPCs (publish_market_listing,
-- cancel_market_listing, buy_market_listing).
--
-- APPLY LAST — only after market-publish, market-cancel, and the updated
-- market-buy Edge Functions are deployed and verified end-to-end.

-- Drop the permissive ALL policy (closes V-04 and V-05 at DB level)
DROP POLICY IF EXISTS "sellers manage own listings" ON market_listings;

-- Explicit no-op INSERT/DELETE blockers (belt and suspenders)
-- SECURITY DEFINER functions bypass RLS, so these only block direct client calls.
-- No INSERT policy = INSERT blocked for all non-DEFINER callers.
-- No DELETE policy = DELETE blocked for all non-DEFINER callers.

-- Keep the existing SELECT policy intact (active + unexpired rows only).
-- UPDATE is no longer needed from the client side either; leave blocked.
