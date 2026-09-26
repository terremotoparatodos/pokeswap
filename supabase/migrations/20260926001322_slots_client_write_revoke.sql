-- RC-0.3 hardening: clients read `slots`, they never write it.
--
-- `slots` has RLS with a single SELECT policy, so INSERT/UPDATE/DELETE from
-- anon/authenticated already match no rows. But the table still carried the
-- Supabase default grants (arwdDxtm), and RLS does not stop TRUNCATE. Every
-- legitimate write goes through SECURITY DEFINER functions (market) or Edge
-- Functions with the service role (swap, free claim), which these grants do
-- not affect. The client, the leaderboard/stats views and the realtime service
-- only read.
--
-- Rollback (restores the previous defaults):
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--     ON TABLE public.slots TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.slots FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.slots TO anon, authenticated;
