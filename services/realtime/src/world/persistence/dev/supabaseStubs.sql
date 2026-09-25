-- LOCAL/TEST ONLY. The smallest slice of a Supabase project the WORLD × SKILLS
-- migration depends on, so the real migration SQL can run in an embedded
-- Postgres (PGlite) with no connection to any Supabase project.
--
-- It deliberately reproduces Supabase's worst case for new tables: default
-- privileges that grant everything to anon and authenticated. The migration
-- must take those back by itself; the tests prove it does.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
-- Supabase reads the caller from the request's JWT; tests set it per statement.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase default privileges on new objects in public (the worst case).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Production's ownership table, reduced to the columns WORLD reads.
CREATE TABLE IF NOT EXISTS public.slots (
  pokemon_id integer PRIMARY KEY,
  owner_id   uuid NULL,
  is_locked  boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.slots TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.slots TO service_role;
