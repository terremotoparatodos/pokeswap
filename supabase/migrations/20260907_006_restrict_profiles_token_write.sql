-- TKN-2: Restrict direct client writes to token-sensitive profile columns (R10)
-- Revokes the broad UPDATE grant on profiles from authenticated role and
-- re-grants only the columns that clients are allowed to write directly
-- (avatar_url, display_name, lang — per TRUST_BOUNDARY.md §3.7).
--
-- After this migration, any direct client call:
--   supabase.from('profiles').update({ tokens: x })
-- will fail with a permission error. Token mutations must go through the
-- server-side RPCs: collect_passive_tokens, spend_tokens_learn_move,
-- skip_swap_cooldown, buy_market_listing (all SECURITY DEFINER).
--
-- APPLY AFTER the R10 Edge Functions and RPCs are deployed and verified.

REVOKE UPDATE ON TABLE profiles FROM authenticated;

GRANT UPDATE (avatar_url, display_name, lang) ON TABLE profiles TO authenticated;
