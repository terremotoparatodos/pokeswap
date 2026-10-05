-- CLOUD JOIN-ORDER-2: read-only check of the join-order functions' trust boundary.
-- Zero rows = closed. One SELECT over the catalog: no writes, safe anywhere.
-- Run it after applying 20261006120000_world_location_join_order.sql; the PGlite test
-- (worldLocationJoinOrder.database.test.js) and the Postgres battery
-- (scripts/world-location/join-order-concurrency) run this exact file. The table itself (its new
-- columns included) is covered by location-grants-check.sql, which must stay at zero rows too.
--
-- Closed means: PUBLIC, anon and authenticated cannot EXECUTE either function (no explicit or
-- default PUBLIC entry); service_role can; both are SECURITY INVOKER with search_path=public.

WITH
clients(role) AS (VALUES ('anon'), ('authenticated')),
wanted(sig) AS (VALUES
  ('world_location_join_order_version()'),
  ('world_location_claim_keyed_v3(uuid,bigint,bigint,uuid,uuid,boolean,boolean,text,bigint)')
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
