-- Client roles get only the privileges the shipped clients use.
--
-- 1. profiles: browsers write only identity and display columns. Economic and
--    verification columns are written by SECURITY DEFINER functions and by
--    Edge Functions that use the service role, never by anon/authenticated.
-- 2. Server-side helpers are callable only by service_role: every production
--    caller is an Edge Function that uses the service role key.
--
-- service_role keeps its own explicit grants. PUBLIC is revoked as well because
-- anon and authenticated would otherwise inherit EXECUTE from it.

-- 1. profiles ------------------------------------------------------------------

REVOKE INSERT, UPDATE ON TABLE public.profiles FROM anon, authenticated;

-- Sign-up upsert writes { id, username } (authApi.signUp).
GRANT INSERT (id, username) ON TABLE public.profiles TO authenticated;
-- Same columns plus the fields TRUST_BOUNDARY.md §3.7 lets the client own.
GRANT UPDATE (id, username, avatar_url, display_name, lang) ON TABLE public.profiles TO authenticated;

-- 2. server-only functions ---------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.claim_slot(integer, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_daily_free_claim() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_slot(integer, uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payment(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_daily_free_claim() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;
