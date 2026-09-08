-- R11: Security hardening — SEC-01, SEC-03, V-06
--
-- SEC-01 (Critical): Enable RLS on kofi_payments.
--   The table had no RLS, making it publicly readable and writable via the anon key.
--   The kofi-webhook Edge Function uses the service-role key and bypasses RLS,
--   so enabling RLS here does not break the webhook — it only blocks anon/authenticated
--   client access, which should never have been allowed.
--
-- SEC-03 (Medium): Drop get_email_by_id.
--   Any authenticated client could call supabase.rpc('get_email_by_id', { user_id: X })
--   and retrieve any user's email. Edge Functions that need an email use the service-role
--   admin API directly; no client-facing caller exists.
--
-- V-06 (INV-ID-2): Add a database CHECK constraint for username minimum length.
--   The 3-character minimum was previously enforced client-side only. A user who
--   bypassed the signup form (or called the API directly) could create a 1- or 2-character
--   username. The handle_new_user() trigger now has a DB-level backstop.

-- ─── SEC-01: kofi_payments RLS ────────────────────────────────────────────

ALTER TABLE kofi_payments ENABLE ROW LEVEL SECURITY;

-- No client-facing policies are added. The only writer is the kofi-webhook
-- Edge Function, which runs with the service-role key (bypasses RLS).
-- Dashboard access (postgres role) is also unaffected.

-- ─── SEC-03: drop get_email_by_id ─────────────────────────────────────────

DROP FUNCTION IF EXISTS get_email_by_id(uuid);

-- ─── V-06: username minimum length ────────────────────────────────────────

ALTER TABLE profiles
  ADD CONSTRAINT profiles_username_min_length
  CHECK (length(trim(username)) >= 3);
