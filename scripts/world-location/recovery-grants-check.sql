-- CLOUD READINESS-3: read-only check of the presence-recovery functions' trust boundary.
-- Zero rows = closed. One SELECT over the catalog: no writes, safe anywhere.
-- Run it after applying 20261005120000_world_presence_recovery.sql; the PGlite test
-- (worldPresenceRecovery.database.test.js) and the Postgres battery
-- (scripts/world-location/recovery-concurrency) run this exact file.
--
-- Closed means: PUBLIC, anon and authenticated cannot EXECUTE any recovery function (no explicit
-- or default PUBLIC entry); service_role can; every function is SECURITY INVOKER with
-- search_path=public.

WITH
clients(role) AS (VALUES ('anon'), ('authenticated')),
wanted(sig) AS (VALUES
  ('world_presence_recovery_version()'), ('world_presence_owner_state(bigint)'),
  ('world_location_claim_keyed_v2(uuid,bigint,bigint,uuid,uuid,boolean)'),
  ('world_presence_activate_exclusive(bigint,uuid,integer)'), ('world_presence_any_active()')
),
fns AS (
  SELECT p.oid, regexp_replace(replace(p.oid::regprocedure::text, ' ', ''), '^public[.]', '') AS sig, p.prosecdef, p.proconfig, p.proacl, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND regexp_replace(replace(p.oid::regprocedure::text, ' ', ''), '^public[.]', '') IN (SELECT sig FROM wanted)
)
SELECT 'missing' AS kind, w.sig AS object, NULL::text AS grantee, NULL::text AS detail
FROM wanted w WHERE NOT EXISTS (SELECT 1 FROM fns WHERE fns.sig = w.sig)
UNION ALL
SELECT 'public_execute', fns.sig, 'PUBLIC', 'EXECUTE'
FROM fns, aclexplode(coalesce(fns.proacl, acldefault('f', fns.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
UNION ALL
SELECT 'execute', fns.sig, r.role, 'EXECUTE' FROM fns CROSS JOIN clients r
WHERE has_function_privilege(r.role, fns.oid, 'EXECUTE')
UNION ALL
SELECT 'service_role_execute', fns.sig, 'service_role', 'EXECUTE' FROM fns
WHERE NOT has_function_privilege('service_role', fns.oid, 'EXECUTE')
UNION ALL
SELECT 'security_definer', fns.sig, NULL, NULL FROM fns WHERE fns.prosecdef
UNION ALL
SELECT 'search_path', fns.sig, NULL, array_to_string(fns.proconfig, ',') FROM fns
WHERE fns.proconfig IS DISTINCT FROM ARRAY['search_path=public']
ORDER BY 1, 2, 3, 4;
