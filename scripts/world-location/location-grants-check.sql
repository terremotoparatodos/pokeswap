-- WORLD LOCATION-2: read-only check of the location store's trust boundary.
-- Zero rows = closed. One SELECT over the catalog: no writes, safe anywhere.
-- Run it after applying 20261001220000_world_player_locations.sql; the PGlite
-- test (worldLocations.database.test.js) runs this exact file.

WITH
clients(role) AS (VALUES ('anon'), ('authenticated')),
privs(priv) AS (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')),
tbl AS (
  SELECT c.oid, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'world_player_locations'
),
fns AS (
  SELECT p.oid, p.oid::regprocedure::text AS sig, p.prosecdef, p.proacl, p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('world_location_claim', 'world_location_save')
)
SELECT 'missing' AS kind, 'world_player_locations' AS object, NULL::text AS grantee, NULL::text AS detail
WHERE NOT EXISTS (SELECT 1 FROM tbl)
UNION ALL
SELECT 'missing', f, NULL, NULL FROM (VALUES ('world_location_claim'), ('world_location_save')) v(f)
WHERE NOT EXISTS (SELECT 1 FROM fns WHERE sig LIKE '%' || f || '(%')
UNION ALL
SELECT 'rls_off', 'world_player_locations', NULL, NULL FROM tbl WHERE NOT relrowsecurity
UNION ALL
SELECT 'policy', 'world_player_locations', NULL, pol.polname::text FROM tbl JOIN pg_policy pol ON pol.polrelid = tbl.oid
UNION ALL
-- Column privileges count too (has_any_column_privilege covers SELECT/INSERT/UPDATE/REFERENCES).
SELECT 'table_privilege', 'world_player_locations', r.role, p.priv
FROM tbl CROSS JOIN clients r CROSS JOIN privs p
WHERE CASE WHEN p.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
           THEN has_any_column_privilege(r.role, tbl.oid, p.priv)
           ELSE has_table_privilege(r.role, tbl.oid, p.priv) END
UNION ALL
SELECT 'service_role_extra', 'world_player_locations', 'service_role', p.priv
FROM tbl CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE')) p(priv)
WHERE has_table_privilege('service_role', tbl.oid, p.priv)
UNION ALL
SELECT 'execute', fns.sig, r.role, 'EXECUTE' FROM fns CROSS JOIN clients r
WHERE has_function_privilege(r.role, fns.oid, 'EXECUTE')
UNION ALL
SELECT 'security_definer', fns.sig, NULL, NULL FROM fns WHERE fns.prosecdef
ORDER BY 1, 2, 3, 4;
